FROM node:16-alpine AS build
#RUN apt-get update && apt-get install -y --no-install-recommends dumb-init
WORKDIR /tmp
ENV NODE_ENV production
ADD package.json /tmp/package.json
RUN npm install 

FROM node:16-alpine

ENV NODE_ENV production
WORKDIR /home/node/app/
COPY  --from=build /tmp/node_modules /home/node/app/node_modules
COPY . /home/node/app
#RUN mkdir /home/node/app/config && \
#    cp ./core/default_config.js /home/node/app/config/config.js && \
#    ln -s /home/node/app/config/config.js /home/node/app/data/config.js
#COPY --chown=node:node ./core/default_config.js /home/node/app/config/config.js
#RUN ln -s /home/node/app/config/config.js /home/node/app/data/config.js

EXPOSE 9000
CMD ["node","core"]
#ENTRYPOINT ["tail", "-f", "/dev/null"]
