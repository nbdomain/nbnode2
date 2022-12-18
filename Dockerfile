FROM node:16

RUN mkdir app
COPY . ./app
COPY ./core/default_config.js ./app/core/config.js
WORKDIR ./app/
RUN npm install


EXPOSE 9000
CMD node core

