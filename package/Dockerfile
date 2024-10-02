#
# build the target container
#
FROM public.ecr.aws/docker/library/debian:buster-20240612

# update the packages
RUN apt-get -y update && apt-get -y upgrade && apt-get -y install curl awscli file zip unzip

# install node
RUN curl -sL https://deb.nodesource.com/setup_18.x | bash -
RUN apt-get -y update && apt-get -y upgrade
RUN apt-get install -y nodejs

# install required dependancies for Chrome headless
# from: https://pptr.dev/troubleshooting
RUN apt-get -y install ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils

# install JAVA 8
# from: https://adoptium.net/installation/linux/#_deb_installation_on_debian_or_ubuntu
RUN mkdir -p /etc/apt/keyrings && wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | tee /etc/apt/keyrings/adoptium.asc
RUN echo "deb [signed-by=/etc/apt/keyrings/adoptium.asc] https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" | tee /etc/apt/sources.list.d/adoptium.list
RUN apt-get -y update && apt-get -y install temurin-8-jdk

# Create the run user and group
RUN groupadd -r --gid 18570 sse && useradd --uid 1984 -r -g sse -G audio,video docker && mkdir /home/docker && chown docker:sse /home/docker

# path, etc
ENV APP_HOME=/v4-videos-indexer
WORKDIR ${APP_HOME}

# install the app
RUN mkdir ${APP_HOME}/common ${APP_HOME}/kanopy ${APP_HOME}/swank
COPY common/ ${APP_HOME}/common
COPY kanopy/ ${APP_HOME}/kanopy
COPY swank/ ${APP_HOME}/swank
COPY index_all_videos ${APP_HOME}
RUN chown -R docker:sse ${APP_HOME}

# Specify the user
USER docker

# install the node packages
ENV NODE_PATH=${APP_HOME}/common/node_modules
RUN cd ${APP_HOME}/common && npm install
RUN ln -s ${APP_HOME}/common/node_modules ${APP_HOME}/kanopy && ln -s ${APP_HOME}/common/node_modules ${APP_HOME}/swank
RUN chown -R docker:sse ${NODE_PATH}

# from: https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md
ENV PUPPETEER_CACHE_DIR=/home/docker/.cache/puppeteer
ENV SANDBOX=${PUPPETEER_CACHE_DIR}/chrome/linux-129.0.6668.70/chrome-linux64/chrome_sandbox
USER root
RUN chown root:root ${SANDBOX} && chmod 4755 ${SANDBOX} && cp -p ${SANDBOX} /usr/local/sbin/chrome-devel-sandbox
USER docker
ENV CHROME_DEVEL_SANDBOX=/usr/local/sbin/chrome-devel-sandbox

#
# end of file
#
