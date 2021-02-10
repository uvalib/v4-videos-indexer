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
RUN yum -y install pango.x86_64 libXcomposite.x86_64 libXcursor.x86_64 libXdamage.x86_64 libXext.x86_64 libXi.x86_64 libXtst.x86_64 cups-libs.x86_64 libXScrnSaver.x86_64 libXrandr.x86_64 GConf2.x86_64 alsa-lib.x86_64 atk.x86_64 gtk3.x86_64 ipa-gothic-fonts xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi xorg-x11-utils xorg-x11-fonts-cyrillic xorg-x11-fonts-Type1 xorg-x11-fonts-misc sudo awscli file java-1.8.0-openjdk-devel

# Create the run user and group
RUN groupadd -r --gid 18570 sse && useradd --uid 1984 -r -g sse docker && mkdir /home/docker

# enable passwordless sudo
RUN echo "docker ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/docker

# Specify the user
USER docker

# install the node packages
RUN sudo npm install -d puppeteer fs dateformat --unsafe-perm=true

#
# end of file
#
