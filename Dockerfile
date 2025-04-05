FROM node:18-alpine AS build
#RUN apt-get update && apt-get install -y --no-install-recommends dumb-init
WORKDIR /tmp
ENV NODE_ENV production
COPY package.json /tmp/
RUN npm install 

FROM node:18-alpine
ENV NODE_ENV production
RUN npm install pm2 -g
#COPY --from=build /usr/bin/dumb-init /usr/bin/dumb-init
WORKDIR /home/node/app/
RUN chown -R node:node /home/node/app
COPY --chown=node:node --from=build /tmp/node_modules /home/node/app/node_modules
COPY --chown=node:node . /home/node/app
#RUN mkdir /home/node/app/config && \
#    cp ./core/default_config.js /home/node/app/config/config.js && \
#    ln -s /home/node/app/config/config.js /home/node/app/data/config.js
USER node

EXPOSE 9000
CMD ["pm2-runtime","/home/node/app/core","-i max"]

#CMD ["node","core"]
#ENTRYPOINT ["tail", "-f", "/dev/null"]
