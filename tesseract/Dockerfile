ARG DISTRIBUTION_DIR=/opt/tesseract_distribution

FROM amazonlinux:2023 as builder

ARG DISTRIBUTION_DIR

ARG LEPTONICA_VERSION=1.85.0
ARG TESSDATA_TYPE=tessdata_fast # choice of tessdata_best, tessdata_fast and tessdata with variable size and quality
ARG TESSDATA_VERSION=4.1.0
ARG TESSERACT_VERSION=5.5.0

ARG LEPTONICA_BUILD_DIR=/tmp/leptonica-build
ARG TESSERACT_BUILD_DIR=/tmp/tesseract-build

ARG LEPTONICA_INSTALL_DIR=/opt/leptonica
ARG TESSERACT_INSTALL_DIR=/opt/tesseract

RUN dnf check-update

# unpacking
RUN dnf install -y \
    gzip \
    tar

# compilation basics
RUN dnf install -y \
    autoconf \
    gcc-c++

# image support in Leptonica, see see https://tesseract-ocr.github.io/tessdoc/InputFormats.html
RUN dnf install -y \
    giflib-devel \
    libjpeg-devel \
    libpng-devel \
    libtiff-devel \
    libwebp-devel \
    openjpeg2-devel

WORKDIR ${LEPTONICA_BUILD_DIR}
RUN curl -L https://github.com/DanBloomberg/leptonica/releases/download/${LEPTONICA_VERSION}/leptonica-${LEPTONICA_VERSION}.tar.gz \
    | tar xz

WORKDIR ${LEPTONICA_BUILD_DIR}/leptonica-${LEPTONICA_VERSION}
RUN ./configure --prefix=${LEPTONICA_INSTALL_DIR} \
    && make \
    && make install


WORKDIR ${TESSERACT_BUILD_DIR}
RUN curl -L https://github.com/tesseract-ocr/tesseract/archive/${TESSERACT_VERSION}.tar.gz \
    | tar xz

# tesseract dependencies
RUN dnf install -y \
    libtool

WORKDIR ${TESSERACT_BUILD_DIR}/tesseract-${TESSERACT_VERSION}
RUN ./autogen.sh \
    && \
        PKG_CONFIG_PATH=/opt/leptonica/lib/pkgconfig \
        LIBLEPT_HEADERSDIR=/opt/leptonica/include \
        ./configure \
            --prefix=${TESSERACT_INSTALL_DIR} --with-extra-includes=/opt/leptonica/include \
            --with-extra-libraries=/opt/leptonica/lib ${COMPILER_OPTIONS} \
    && make \
    && make install

RUN mkdir -p ${DISTRIBUTION_DIR}/lib/

RUN cp -r ${TESSERACT_INSTALL_DIR}/bin/ ${DISTRIBUTION_DIR}/
RUN cp ${TESSERACT_INSTALL_DIR}/lib/*.so* ${DISTRIBUTION_DIR}/lib/
RUN cp ${LEPTONICA_INSTALL_DIR}/lib/*.so* ${DISTRIBUTION_DIR}/lib/

RUN cp /usr/lib64/libgomp.so* ${DISTRIBUTION_DIR}/lib/

RUN cp /usr/lib64/libgif.so* ${DISTRIBUTION_DIR}/lib/
RUN cp /usr/lib64/libjbig.so* ${DISTRIBUTION_DIR}/lib/
RUN cp /usr/lib64/libjpeg.so* ${DISTRIBUTION_DIR}/lib/
RUN cp /usr/lib64/libopenjp2.so* ${DISTRIBUTION_DIR}/lib/
RUN cp /usr/lib64/libpng.so* ${DISTRIBUTION_DIR}/lib/
RUN cp /usr/lib64/libpng16.so* ${DISTRIBUTION_DIR}/lib/
RUN cp /usr/lib64/libtiff.so* ${DISTRIBUTION_DIR}/lib/
RUN cp /usr/lib64/libwebp.so* ${DISTRIBUTION_DIR}/lib/
RUN cp /usr/lib64/libwebpmux.so* ${DISTRIBUTION_DIR}/lib/

RUN find ${DISTRIBUTION_DIR}/lib -type f -name '*.so*' | xargs strip

RUN mkdir -p ${DISTRIBUTION_DIR}/share/tessdata/

RUN curl -L https://github.com/tesseract-ocr/${TESSDATA_TYPE}/raw/${TESSDATA_VERSION}/eng.traineddata \
    > ${DISTRIBUTION_DIR}/share/tessdata/eng.traineddata

FROM amazonlinux:2023

ARG DISTRIBUTION_DIR

ENV LD_LIBRARY_PATH=${DISTRIBUTION_DIR}/lib:${LD_LIBRARY_PATH}
ENV PATH=${DISTRIBUTION_DIR}/bin:${PATH}

ENV TESSDATA_PREFIX=${DISTRIBUTION_DIR}/share/tessdata/

COPY --from=builder ${DISTRIBUTION_DIR} ${DISTRIBUTION_DIR}
