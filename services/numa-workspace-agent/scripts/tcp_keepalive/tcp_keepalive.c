/*
 * LD_PRELOAD shim that forces TCP keepalive on every outbound TCP socket.
 *
 * Why: Bedrock streaming connections silently die after ~360s of network idle,
 * during which the model has stopped emitting tokens but the connection is
 * still semantically alive. We see this as 15+ minute "stalls" where the
 * connection survives in the kernel but the stream produces no events. The
 * bundled Node CLI we use for Bedrock invocations does not set SO_KEEPALIVE
 * with usable timing — production traces show a hard 360s ceiling across
 * 1,132 healthy messages and 7 customer accounts, consistent with a network
 * device killing idle TCP connections.
 *
 * Fix: intercept connect(2). When it succeeds on an AF_INET/AF_INET6 SOCK_STREAM
 * socket, force SO_KEEPALIVE + TCP_KEEPIDLE=60 + TCP_KEEPINTVL=30 +
 * TCP_KEEPCNT=5. First probe fires after 60s of idle, subsequent probes every
 * 30s, give up after 5 probes (= ~210s worst case). All well under the 360s
 * ceiling.
 *
 * Loaded into the Claude Agent SDK Node subprocess via the LD_PRELOAD env var
 * (set in sdk_config.py). Affects every outbound TCP socket the subprocess
 * opens — Bedrock, Anthropic API, AgentCore proxy, etc. Keepalive on healthy
 * connections is benign.
 *
 * On failure to look up the next connect symbol or to set socket options,
 * we log to stderr and continue — never block the original call.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>

/* Tuning. Override via env vars if needed for experiments. */
static int kp_idle = 60;     /* seconds idle before first probe */
static int kp_intvl = 30;    /* seconds between probes */
static int kp_count = 5;     /* probes before giving up */
static int kp_inited = 0;
static int kp_verbose = 0;

typedef int (*connect_fn)(int sockfd, const struct sockaddr *addr, socklen_t addrlen);
static connect_fn real_connect = NULL;

static void init_once(void) {
    if (kp_inited) return;
    kp_inited = 1;

    const char *env;
    if ((env = getenv("NUMA_TCP_KEEPIDLE")) != NULL) kp_idle = atoi(env);
    if ((env = getenv("NUMA_TCP_KEEPINTVL")) != NULL) kp_intvl = atoi(env);
    if ((env = getenv("NUMA_TCP_KEEPCNT")) != NULL) kp_count = atoi(env);
    if (getenv("NUMA_TCP_KEEPALIVE_VERBOSE") != NULL) kp_verbose = 1;

    real_connect = (connect_fn) dlsym(RTLD_NEXT, "connect");
    if (real_connect == NULL && kp_verbose) {
        fprintf(stderr, "[tcp_keepalive] dlsym(connect) failed: %s\n", dlerror());
    }
    if (kp_verbose) {
        fprintf(stderr, "[tcp_keepalive] loaded; idle=%d intvl=%d count=%d\n",
                kp_idle, kp_intvl, kp_count);
    }
}

static void apply_keepalive(int sockfd, const struct sockaddr *addr) {
    if (addr == NULL) return;
    /* Only TCP sockets on IP families. */
    int sotype = 0;
    socklen_t solen = sizeof(sotype);
    if (getsockopt(sockfd, SOL_SOCKET, SO_TYPE, &sotype, &solen) != 0) return;
    if (sotype != SOCK_STREAM) return;
    if (addr->sa_family != AF_INET && addr->sa_family != AF_INET6) return;

    int one = 1;
    if (setsockopt(sockfd, SOL_SOCKET, SO_KEEPALIVE, &one, sizeof(one)) != 0) {
        if (kp_verbose) fprintf(stderr, "[tcp_keepalive] SO_KEEPALIVE failed fd=%d: %s\n",
                                sockfd, strerror(errno));
        return;
    }
#ifdef TCP_KEEPIDLE
    if (setsockopt(sockfd, IPPROTO_TCP, TCP_KEEPIDLE, &kp_idle, sizeof(kp_idle)) != 0) {
        if (kp_verbose) fprintf(stderr, "[tcp_keepalive] TCP_KEEPIDLE failed fd=%d: %s\n",
                                sockfd, strerror(errno));
    }
#endif
#ifdef TCP_KEEPINTVL
    if (setsockopt(sockfd, IPPROTO_TCP, TCP_KEEPINTVL, &kp_intvl, sizeof(kp_intvl)) != 0) {
        if (kp_verbose) fprintf(stderr, "[tcp_keepalive] TCP_KEEPINTVL failed fd=%d: %s\n",
                                sockfd, strerror(errno));
    }
#endif
#ifdef TCP_KEEPCNT
    if (setsockopt(sockfd, IPPROTO_TCP, TCP_KEEPCNT, &kp_count, sizeof(kp_count)) != 0) {
        if (kp_verbose) fprintf(stderr, "[tcp_keepalive] TCP_KEEPCNT failed fd=%d: %s\n",
                                sockfd, strerror(errno));
    }
#endif
    if (kp_verbose) {
        fprintf(stderr, "[tcp_keepalive] applied to fd=%d family=%d\n", sockfd, addr->sa_family);
    }
}

int connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
    init_once();
    if (real_connect == NULL) {
        errno = ENOSYS;
        return -1;
    }
    int rc = real_connect(sockfd, addr, addrlen);
    /* EINPROGRESS is the normal return for non-blocking sockets; the socket
     * is real and usable, so apply keepalive immediately. EAGAIN is rare but
     * valid for AF_UNIX; we already filtered for IP families above. */
    if (rc == 0 || errno == EINPROGRESS) {
        int saved_errno = errno;
        apply_keepalive(sockfd, addr);
        errno = saved_errno;
    }
    return rc;
}
