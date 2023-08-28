#
# build the target container
#
FROM public.ecr.aws/amazonlinux/amazonlinux:2023.1.20230825.0 

# update the packages
RUN dnf -y update && dnf -y install docker sudo nodejs

# install required dependancies
#RUN yum -y install pango.x86_64 libXcomposite.x86_64 libXcursor.x86_64 libXdamage.x86_64 libXext.x86_64 libXi.x86_64 libXtst.x86_64 cups-libs.x86_64 libXScrnSaver.x86_64 libXrandr.x86_64 GConf2.x86_64 alsa-lib.x86_64 atk.x86_64 gtk3.x86_64 ipa-gothic-fonts xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi xorg-x11-utils xorg-x11-fonts-cyrillic xorg-x11-fonts-Type1 xorg-x11-fonts-misc sudo awscli file java-1.8.0-openjdk-devel zip unzip

# Create the run user and group
RUN groupadd -r --gid 18570 sse && useradd --uid 1984 -r -g sse -G audio,video docker && mkdir /home/docker && chown docker:sse /home/docker

# enable passwordless sudo
RUN echo "docker ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/docker

# path, etc
ENV APP_HOME /v4-videos-indexer
WORKDIR ${APP_HOME}

# install the node packages
ENV NODE_PATH ${APP_HOME}/node_modules
RUN mkdir -p ${APP_HOME}/node_modules
COPY common/package-lock.json common/package.json ${APP_HOME}
RUN npm install
RUN chown -R docker:sse ${NODE_PATH}

# Specify the user
#USER docker

#
# end of file
#
