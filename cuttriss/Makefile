# Deploy the Synergy -> Bedrock KB job to the in-region (us-east-2) EC2 and run it.
#
# The box's PUBLIC IP changes when it is stopped/started. If `make ssh` times out,
# get the current IP from the console (or: aws ec2 describe-instances) and override:
#   make push HOST=ec2-user@<new-public-dns-or-ip>
#
# Typical flow:
#   make push          # copy runner + extractor up
#   make ssh           # log in, then: cd ~ && nohup ./run_synergy_kb.sh all > run.log 2>&1 &
#   make tail          # follow progress from your laptop

KEY  ?= ~/.ssh/synergy-pull-live.pem
HOST ?= ec2-user@ec2-3-135-249-192.us-east-2.compute.amazonaws.com
DEST ?= /home/ec2-user
SSH  := ssh -i $(KEY) -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new
SCP  := scp -i $(KEY) -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new

.PHONY: push ssh run tail status

push:          ## copy the runner + extractor to the EC2
	$(SCP) run_synergy_kb.sh ../tools/synergy_s3_text_extractor.py $(HOST):$(DEST)/
	$(SSH) $(HOST) 'chmod +x $(DEST)/run_synergy_kb.sh'
	@echo "pushed. now: make ssh   (then ./run_synergy_kb.sh all)"

ssh:           ## interactive login
	$(SSH) $(HOST)

run:           ## start the full job detached (survives logout)
	$(SSH) $(HOST) 'cd $(DEST) && nohup ./run_synergy_kb.sh all > run.log 2>&1 & echo "started pid $$!"'

tail:          ## follow the run log
	$(SSH) $(HOST) 'tail -f $(DEST)/run.log'

status:        ## last 30 log lines
	$(SSH) $(HOST) 'tail -n 30 $(DEST)/run.log'
