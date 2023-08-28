#
# build the target container
#
FROM public.ecr.aws/amazonlinux/amazonlinux:2.0.20230822.0

# update the packages
RUN yum -y update

# install node
RUN curl -sL https://rpm.nodesource.com/setup_16.x | bash -
RUN yum install -y nodejs

# install required dependancies
RUN yum -y install pango.x86_64 libXcomposite.x86_64 libXcursor.x86_64 libXdamage.x86_64 libXext.x86_64 libXi.x86_64 libXtst.x86_64 cups-libs.x86_64 libXScrnSaver.x86_64 libXrandr.x86_64 GConf2.x86_64 alsa-lib.x86_64 atk.x86_64 gtk3.x86_64 ipa-gothic-fonts xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi xorg-x11-utils xorg-x11-fonts-cyrillic xorg-x11-fonts-Type1 xorg-x11-fonts-misc sudo awscli file java-1.8.0-openjdk-devel zip unzip

# Create the run user and group
RUN groupadd -r --gid 18570 sse && useradd --uid 1984 -r -g sse -G audio,video docker && mkdir /home/docker && chown docker:sse /home/docker

# path, etc
ENV APP_HOME /v4-videos-indexer
WORKDIR ${APP_HOME}

# install the app
RUN mkdir ${APP_HOME}/common ${APP_HOME}/kanopy ${APP_HOME}/swank
COPY common/ ${APP_HOME}/common
COPY kanopy/ ${APP_HOME}/kanopy
COPY swank/ ${APP_HOME}/swank
COPY index_all_videos ${APP_HOME}

# install the node packages
ENV NODE_PATH ${APP_HOME}/common/node_modules
RUN cd ${APP_HOME}/common && npm install
RUN ln -s ${APP_HOME}/common/node_modules ${APP_HOME}/kanopy && ln -s ${APP_HOME}/common/node_modules ${APP_HOME}/swank
RUN chown -R docker:sse ${NODE_PATH}

# Specify the user
USER docker

#
# end of file
#
