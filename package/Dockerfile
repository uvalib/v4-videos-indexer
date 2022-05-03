#
# build the target container
#
FROM centos:7

# update the packages
RUN yum -y update && yum -y install curl

# install node
RUN curl -sL https://rpm.nodesource.com/setup_14.x | bash -
RUN yum install -y nodejs

# install required dependancies
RUN yum -y install pango.x86_64 libXcomposite.x86_64 libXcursor.x86_64 libXdamage.x86_64 libXext.x86_64 libXi.x86_64 libXtst.x86_64 cups-libs.x86_64 libXScrnSaver.x86_64 libXrandr.x86_64 GConf2.x86_64 alsa-lib.x86_64 atk.x86_64 gtk3.x86_64 ipa-gothic-fonts xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi xorg-x11-utils xorg-x11-fonts-cyrillic xorg-x11-fonts-Type1 xorg-x11-fonts-misc sudo awscli file java-1.8.0-openjdk-devel zip unzip

# Create the run user and group
RUN groupadd -r --gid 18570 sse && useradd --uid 1984 -r -g sse -G audio,video docker && mkdir /home/docker && chown docker:sse /home/docker

# enable passwordless sudo
RUN echo "docker ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/docker

# install the node packages
ENV NODE_PATH /node_modules
RUN npm install -d puppeteer fs dateformat
RUN chown -R docker:sse $NODE_PATH

# Specify the user
USER docker

# from: https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-puppeteer-in-docker
ENV SB=$NODE_PATH/puppeteer/.local-chromium/linux-982053/chrome-linux/chrome_sandbox
RUN sudo chown root:root $SB && sudo chmod 4755 $SB && sudo cp -p $SB /usr/local/sbin/chrome-devel-sandbox
ENV CHROME_DEVEL_SANDBOX=/usr/local/sbin/chrome-devel-sandbox

#
# end of file
#
