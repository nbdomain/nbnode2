FROM node:16-alpine AS build
#RUN apt-get update && apt-get install -y --no-install-recommends dumb-init
WORKDIR /tmp
ENV NODE_ENV production
ADD package.json /tmp/package.json
RUN npm install 

FROM node:16-alpine

ENV NODE_ENV production
#COPY --from=build /usr/bin/dumb-init /usr/bin/dumb-init
WORKDIR /home/node/app/
RUN chown -R node:node /home/node/app
COPY --chown=node:node --from=build /tmp/node_modules /home/node/app/node_modules
COPY --chown=node:node . /home/node/app
RUN mkdir /home/node/app/config
COPY --chown=node:node ./core/default_config.js /home/node/app/config/config.js
RUN rm /home/node/app/data/config.js && \
    ln -s /home/node/app/config/config.js /home/node/app/data/config.js

EXPOSE 9000
USER node
CMD ["node","core"]

