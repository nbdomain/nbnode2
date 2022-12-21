FROM node:16-alpine AS build
#RUN apt-get update && apt-get install -y --no-install-recommends dumb-init

WORKDIR /tmp
ENV NODE_ENV production
ADD package.json /tmp/package.json
RUN npm install 

FROM node:16-alpine

ENV NODE_ENV production
#COPY --from=build /usr/bin/dumb-init /usr/bin/dumb-init
USER node
WORKDIR /opt/app/
COPY --chown=node:node --from=build /tmp/node_modules /opt/app/node_modules
COPY --chown=node:node . /opt/app
COPY ./core/default_config.js /opt/app/core/config.js
EXPOSE 9000

CMD ["node","core"]

