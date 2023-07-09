/**
 * server.js
 *
 * Express server that exposes the Indexer
 */

//const express = require('express')
//const morgan = require('morgan')
//const bodyParser = require('body-parser')
//const cors = require('cors')
const http = require('http')
const fastifyModule = require('fastify')
const cors = require('@fastify/cors')
const httpProxy = require('@fastify/http-proxy')

const URL = require('url')
var dns = require("dns");
var axios = require("axios");
const { ExpressPeerServer } = require('peer');
const { createProxyMiddleware } = require("http-proxy-middleware");
const { createCipheriv } = require('crypto');
const { Nodes } = require('./nodes');
const Path = require('path')



// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------
const SSLDir = "./ssl.d/";
let greenlock = null;
let domainMap = {};
let localWebGateway = null;
let localAPIGateway = null;
let localDomain = ""
var selfsigned = require('selfsigned');


async function proxyRequest(req, res, path, nbdomain) {
  try {
    const cookie = req.headers
      ? req.headers.cookie
        ? req.headers.cookie
        : ""
      : "";
    //const url = localGateway + nbdomain + path;
    const url = localWebGateway + nbdomain + path;
    console.log("getting url:", url);
    let res1 = await axios.get(url, {
      method: "GET",
      withCredentials: true,
      headers: { Cookie: cookie },
      responseType: "stream",
    });
    res.set(res1.headers);
    res1.data.pipe(res);
  } catch (e) {
    //console.log(e);
    res.status(e.response.status).send(e.response.message);
    //res.end(e.message);
  }
}
async function getNBLink(domain) {
  console.log("getting TXT of:", domain);
  return new Promise((resolve) => {
    dns.resolve(domain, "TXT", (err, data) => {
      try {
        for (let i = 0; i < data.length; i++) {
          if (data[i][0]) {
            const nblink = data[i][0].split("=");
            if (nblink[0] === "nblink") {
              console.log("found nblink:", nblink[1]);
              resolve(nblink[1]);
              return;
            }
          }
        }
      } catch (e) { }
      console.log(domain, ": No NBlink found");
      resolve(null);
    });
  });
}
function isAPICall(host) {
  return (
    host.indexOf("localhost") != -1 ||
    host.indexOf("127.0.0.1") != -1 ||
    host.indexOf(localDomain) != -1
  );
}

// ------------------------------------------------------------------------------------------------
// LocalServer
// ------------------------------------------------------------------------------------------------

class LocalServer {
  constructor(indexers, logger, port) {
    this.indexers = indexers
    this.logger = logger
    this.listener = null
    this.onListening = null
  }

  async start() {

    //const app = express()

    setInterval(() => {
      //console.log("clear domainMap cache");
      domainMap = []; //clear domainMap cache
    }, 60 * 1000);

    await this.startServer();

    return true
    //  this.startSSLServer(app);
  }

  /*  async startSSLServer() {
      const {config} = this.indexers
  
      //Start HTTPS server
      if (config.server.publicUrl && config.server.autoSSL) {
        const pURL = URL.parse(config.server.publicUrl)
        localDomain = pURL.hostname
        var appSSL = express();
        const localAPI = "http://localhost:" + config.server.port;
        appSSL.use(createProxyMiddleware("**", { target: localAPI }));
        let domainError = {};
        greenlock = require("@root/greenlock").create({
          packageRoot: Path.join(__dirname , "/../"),
          configDir: SSLDir,
          maintainerEmail: config.node_info.contact,
          notify: async function (event, details) {
            if ("error" === event) {
            }
          },
        });
        const res = await greenlock.sites.add({
          subject: pURL.hostname,
          altnames: [pURL.hostname],
        });
        console.log("sites.add", res);
        const green = require("greenlock-express").init(() => {
          return {
            greenlock,
            cluster: false,
          };
        });
        // Serves on 80 and 443
        // Get's SSL certificates magically!
        green.serve(appSSL);
      }
    } */
  async startServer() {
    const { config, CONSTS, logger } = this.indexers
    const serverFactory = (handler, opts) => {
      this.listener = http.createServer((req, res) => {
        handler(req, res)
      })
      return this.listener
    }
    const app = fastifyModule({ http2: false, caseSensitive: false })
    this.listener = app.server
    /* app.get("/", (req, res, next) => {
       if (!isAPICall(req.get("host"))) {
         next();
         return;
       }
       res.sendFile(Path.join(__dirname, "/public/index.html"));
     });*/
    //app.use('/files/', express.static(Path.join(__dirname, '../data/files')))
    app.register(require('@fastify/static'), {
      root: Path.join(__dirname, '../data/files'),
      prefix: '/files/', // optional: default '/'
      //      constraints: { host: 'example.com' } // optional: default {}
    })

    const self = this;

    logger.info(`NBnode server started on port ${config.server.port}...`);

    /*var proxyPassConfig = CONSTS.proxy_map;

    for (let uri in proxyPassConfig) {
      uri = uri.trim().toLowerCase();
      console.log("uri", uri);
      let env = config;
      env.indexers = self.indexers;
      let service_folder = proxyPassConfig[uri];
      let port = 0;
      try {
        const service = require("./modules/" + service_folder + "/index.js");
        port = await service(env);
      } catch (e) {
        console.error("Error loading service from: " + service_folder)
        continue
      }
      const localAddr = "http://localhost:" + port;
      //const pa = "^" + uri;
      const pa = uri
      if (uri === "/web/") localWebGateway = localAddr + "/";
      if (uri === "/api/") localAPIGateway = localAddr + "/";
    }*/
    const moduleConfig = CONSTS.modules
    let service_folder = ""
    for (let uri in moduleConfig) {
      uri = uri.trim().toLowerCase();
      try {
        service_folder = moduleConfig[uri];
        const serviceClass = require("./modules/" + service_folder + "/index.js");
        const service = new serviceClass
        service.init(uri, this.indexers)
        service.regEndpoints(app)
      } catch (e) {
        console.error("Error loading service from: " + service_folder)
        continue
      }
    }
    app.register(cors, { origin: true, credentials: true, allowedHeaders: ['apikey', 'content-type'] });

    //        app.use(bodyParser.json({ limit: '50mb' }));
    //        app.use(bodyParser.urlencoded({ limit: '50mb', extended: false, parameterLimit: 50000 }));
    await app.listen({ host: "::", port: config.server.port })
    return this.listener
  }

  async stop() {
    if (!this.listener) return
    await this.listener.close()
    this.listener = null
  }

  /*  async addNBlink(req, res, next) {
      try {
        if (!isAPICall(req.get("host"))) {
          next();
          return;
        }
        const domain = req.query["domain"];
        console.log("Adding domain:", domain);
        const nbLink = await getNBLink(domain);
        const ret = {
          code: nbLink ? 0 : 1,
          message: nbLink ? nbLink : domain + ":No NBlink found in DNS record",
        };
        res.json(ret);
        console.log("nbLink:", nbLink);
        if (ret.code == 0 && greenlock) { //add ssl
          const res = await greenlock.sites.add({
            subject: domain,
            altnames: [domain],
          });
        }
        return;
      } catch (e) { next(e) }
    }*/


  async getAll(req, res, next) {
    console.log("getall")
    try {
      const host = req.get("host");
      //console.log(host);
      if (isAPICall(host)) {
        //console.log("got local call, ignore...");
        next();
        return;
      }
      let nbdomain = domainMap[host];
      if (nbdomain === "none") {
        //already checked
        next();
        return;
      }
      if (!nbdomain) {
        nbdomain = await getNBLink(host);
        if (nbdomain) domainMap[host] = nbdomain;
        else {
          domainMap[host] = "none";
          next();
          return;
        }
      }
      proxyRequest(req, res, req.path, nbdomain);
    } catch (e) { next(e) }
  }


}

// ------------------------------------------------------------------------------------------------

module.exports = LocalServer
