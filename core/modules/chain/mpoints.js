"use strict";

const process = require("process");
const CoinFly = require('coinfly');
const axios = require('axios')
const Arweave = require('arweave');
const fs = require("fs");
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')

const PATH_ADDRESS = "/v1/address";
const PATH_TX_ALL = "/v1/tx/all";
const PATH_TX_MAIN = "/v1/tx/main";

let arLib = null
//获取访问id
function getClientIp(req) {
  const IP =
    req.headers["x-forwarded-for"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.connection.socket.remoteAddress;
  return IP.split(",")[0];
}
if (!fs.existsSync("logg")) {
  fs.mkdirSync("logg");
}
var logStream = fs.createWriteStream("logg/loggs.txt", { flags: "a" });
// use {flags: 'a'} to append and {flags: 'w'} to erase and write a new file

function log(...args) {
  let today = new Date();
  let time = today.getDay() + ":" + today.getHours() + ":" + today.getMinutes();
  let str = `[${time}] `;
  for (let key of args) {
    if (typeof key === "object" && key !== null) {
      str += JSON.stringify(key) + " ";
    } else str += key + " ";
  }
  logStream.write(str + "\n");
  console.log(...args);
}

const Crawler = require("./crawler");
const coinflyMin = require("coinfly");

const crawler = new Crawler

class mPoints {
  constructor() {
  }
  start(cb) {
    arLib = Arweave.init({ host: "arweave.net", port: 443, protocol: "https" });
    const app = express()
    const self = this;
    app.use(cors());
    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ limit: '50mb', extended: false, parameterLimit: 50000 }));

    app.get(PATH_ADDRESS, async (req, res) => {
      console.log("calling:", PATH_ADDRESS, "query:", req.query)
      var data = await mPoints.getAddressInfo(req.query.address, req.query.chain);
      res.json(data);
    })
    app.get('/:chain/address/:address/balance', async (req, res) => {
      const address = req.params['address']
      const chain = req.params['chain']
      const ret = await mPoints.getBalance(address, chain)
      res.json(ret)
    })
    app.get(PATH_TX_ALL, async (req, res) => {
      console.log("calling:", PATH_TX_ALL, "query:", req.query)
      var data = await this.getAllTX({
        address: req.query.address,
        num: Number(req.query.num),
        sort: Number(req.query.sort),
        start: Number(req.query.start),
        end: Number(req.query.end),
        skip: Number(req.query.skip),
        chain: req.query.chain
      });
      res.json(data);
    })
    app.get("/:chain/address/:address/prefetch", (req, res) => {
      const address = req.params['address']
      const chain = req.params['chain']
      this.preFetchAddress({ address, chain })
      res.json({ code: 0, msg: "ok" })
    })
    app.get("/:chain/address/:address/history", async (req, res) => {
      const address = req.params['address']
      const chain = req.params['chain']
      console.log("calling:", req.url, "query:", req.query)
      var data = await this.getAllTX({
        address,
        num: Number(req.query.num),
        sort: Number(req.query.sort),
        start: Number(req.query.start),
        end: Number(req.query.end),
        skip: Number(req.query.skip),
        chain: chain
      });
      res.json(data)
    })
    app.get('/test', async (req, res) => {
      const lib = await CoinFly.create('ar')
      const pubKey = await lib.getPublicKey(process.env.arkey)
      const address = await lib.getAddress(pubKey)
      console.log(pubKey)
      console.log(address)
      res.end(address)
    })
    const server = app.listen(0, function () {
      const port = server.address().port;
      console.log(`chain service started on port:`, port);
      cb(port)
    })
  }
  static async getBalance(address, chain) {
    const lib = await CoinFly.create(chain)
    if(lib){
      return await lib.getBalance(address)
    }
    return { code: 1, msg: "not implemented" }
  }
  static async getAddressInfo(address, chain) {
    if (!chain) chain = 'bsv'
    const lib = await CoinFly.create(chain)
    if (!lib) return null
    const ret = { balance: await lib.getBalance(address) }
    return ret
  }

  async preFetchAddress({ address, chain = 'bsv' }) {
    crawler.preFetch({ address, chain })
  }
  async getAllTX({ address, num, sort, start, end, skip, chain }) {
    if (!address) return null;

    address = address.trim();
    if (!address) return null;
    if (isNaN(num)) num = 100;
    if (isNaN(sort)) sort = -1;
    if (isNaN(start)) start = 0;
    if (isNaN(end)) end = 0;
    if (isNaN(skip)) skip = 0;
    return await crawler.getTxHistory({ address, num, start, end, chain })
  }
}

module.exports = mPoints;
