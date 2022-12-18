FROM node:16-alpine

RUN mkdir app
COPY . ./app
COPY ./core/default_config.js ./app/core/config.js
WORKDIR ./app/
RUN yarn install


EXPOSE 9000
CMD node core

