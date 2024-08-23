/**
 * NBDomain HTTP server for 3rd party.
 */
var url = require('url');

/*var express = require('express');
var bodyParser = require("body-parser");
var cors = require('cors');
const { json } = require('body-parser');
const rateLimit = require('express-rate-limit')
*/

const fastifyModule = require('fastify')
const cors = require('@fastify/cors')

const { ERR } = require('../../def')
const { Util } = require('../../util.js')
const Path = require('path')


const fs = require("fs-extra");
const axios = require('axios');
const Parser = require('../../parser')
const { Nodes } = require('../../nodes')
const { createSession } = require("better-sse");
const coinfly = require("coinfly");
let indexers = null, config = null;
const today = new Date();

const day = today.getDate();
const today_folder = day % 2 == 0 ? "even/" : "odd/";
const last_folder = day % 2 == 0 ? "odd/" : "even/";



//获取访问ip
function getClientIp(req) {
    let IP =
        req.headers["x-forwarded-for"] ||
        //req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;
    IP = IP.split(',')[0]
    IP = IP.split(":").pop()
    return IP;
}
class appModule {
    init(preFix, indexers) {
        this.preFix = preFix
        this.indexers = indexers
    }
    async regEndpoints(app) {
        const { config } = this.indexers
        const PREFIX = this.preFix
        const indexers = this.indexers
        const { db, Util } = indexers
        app.addHook("preHandler", function checkAccess(req, res, done) {
            if (process.env.allowIPs) {
                const allowIPs = process.env.allowIPs.split(' ')
                const IP = getClientIp(req)
                const ips = IP.split('.')
                if (allowIPs.indexOf(IP) == -1 && config?.nodeIPs?.indexOf(IP) === -1 && IP != '1'
                    && ips[0] !== "127" && ips[0] !== "10" && !(ips[0] == "172" && +ips[1] >= 16 && +ips[1] <= 31) && !(ips[0] === "192" && ips[1] === "168")) {
                    console.error("not allowed:", IP)
                    res.send("not allowed")
                }
            }
            done()
        })
        app.get(PREFIX + '/', async function (req, res, next) {
            const t1 = Date.now()
            let domain = req.query['nid'];
            let f = req.query['full'] === 'true';
            const price = req.query['price'] !== 'false';

            if (!domain) {
                return ({ code: ERR.NOTFOUND, message: `nid missing!` });
                return;
            }
            try {
                const resolver = indexers.resolver
                if (!resolver) {
                    throw "unsupported domain:" + domain
                }
                const ret = await resolver.readDomain({ fullDomain: domain, forceFull: f, price });
                if (ret.code === 0) {
                    ret.chain = Util.getchain(domain)
                }
                const t2 = Date.now()
                console.log("read Domain:", domain, "time=", (t2 - t1) / 1000)
                return (ret);
            } catch (err) {
                console.error(err);
                return ({ code: 99, message: err.message });
            }
        });
        async function getAllItems(para, forceFull = false, from = null, price = true) {
            //check ,
            const t1 = Date.now()

            let items = []
            const domains = para.split(',')

            domains.forEach(domain => {
                const his = domain.split('/') //check '/'
                if (his.length == 1) items.push(domain)
                else {
                    const moreHis = his[1].split('-') //check '-'
                    if (moreHis.length == 1) {
                        if (his[1] == 'all') {
                            const resolver = indexers.resolver
                            if (!resolver) return
                            const count = resolver.getDomainHistoryLen(his[0])
                            for (let i = 1; i <= count; i++) {
                                items.push(his[0] + "/" + i)
                            }
                            items.push(his[0])
                        } else items.push(domain)
                    }
                    else {
                        for (let i = +moreHis[0]; i <= +moreHis[1]; i++) {
                            items.push(his[0] + "/" + i)
                        }
                    }
                }
            })
            let ret = []
            for (const item of items) {
                if (item === '') continue;
                const dd = item.split('/')
                const resolver = indexers.resolver
                if (!resolver) continue;
                const result = await resolver.readDomain({ fullDomain: dd[0], forceFull: forceFull, history: dd[1], price })
                if (!result) continue
                if (from && result.obj.ts <= from) continue
                ret.push(result)
            }
            const t2 = Date.now()
            console.log("getAllItems:", para, " time=", (t2 - t1) / 1000)

            return ret
        }
        app.get(PREFIX + '/q/*', async function (req, res) {
            const para = req.params['*']
            const from = req.query['from']
            const price = req.query['price'] !== "false"
            const ret = await getAllItems(para, false, +from, price)
            return (ret)
        })
        app.get(PREFIX + '/qf/*', async function (req, res) {
            const para = req.params['*']
            const from = req.query['from']
            const ret = await getAllItems(para, true, from)
            return (ret)
        })
        app.get(PREFIX + '/qc/:q', function (req, res) {
            const q = req.params['q']
            const result = db.queryChildCount(q);
            return (result);
        });
        app.post(PREFIX + '/mq/', async function (req, res) {
            return { code: 100, msg: "deprecated" }
            const q = req.body
            const result = await db.mangoQuery(q);
            return (result);
        });
        app.post(PREFIX + '/dbq/', async (req, res) => {
            const t1 = Date.now()

            const apikey = req.headers.apikey
            if (config.apikey && config.apikey.indexOf(apikey) === -1) {
                return { code: 100, msg: "no access" }
            }
            let { exp, para, tld, method = 'get' } = req.body
            const ret = (await db.API_runQuery({ exp, para, tld, method }))
            const t2 = Date.now()
            console.log("/dbq:", para, " time=", (t2 - t1) / 1000)
            return ret
        })

        app.get(PREFIX + '/user/:account', async function (req, res) {
            const account = req.params['account']
            const resolver = indexers.resolver
            const ret = await resolver.readUser(account)
            return (ret)
        })
        app.get(PREFIX + '/fetchtx/:txid', async (req, res) => {
            const txid = req.params['txid']
            handleNewTx({ txid, force: true })
            return ("ok")
        })
        app.get(PREFIX + '/deletetx/:txid', async (req, res) => {
            const txid = req.params['txid']
            db.deleteTransaction(txid)
            return ("ok")
        })

        app.post(PREFIX + '/sendTx', async function (req, res) {
            const { logger } = indexers
            const obj = req.body;
            const IP = getClientIp(req)
            console.log('/sendTx body:', obj)
            const ret = await Nodes.sendNewTx(obj)
            if (ret.code != 0)
                console.error("/sendTx error: ", ret)
            return (ret);
        });
        app.post(PREFIX + '/verifyDMs', async function (req, res) {
            const { logger, db } = indexers
            const { items, type, from, info } = req.body;
            return await db.verifyIncomingItems({ items, type, from, info });
        });
        app.post(PREFIX + '/readRawItems', async function (req, res) {
            const { logger, db } = indexers
            const { items, type } = req.body;
            return await db.readRawItems(items, type);
        });
        async function handleNewTx({ txid, force = false }) {
            if (!db.hasTransaction(txid) || force) {
                const data = await Nodes.getTx(txid)
                if (data) {
                    console.log("handleNewTx:", txid)
                    await indexers.indexer.addTxFull({ txid: txid, sigs: data.tx.sigs, rawtx: data.tx.rawtx || data.rawtx, time: data.tx.time, txTime: data.tx.txTime, oDataRecord: data.oDataRecord, force, chain: data.tx.chain })
                }
            }
        }
        function save_pr(body, isNotify) {
            var data = JSON.stringify(body);
            var id = body.id;
            let dir = Path.join(__dirname, "/tx/");
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
            }
            dir += today_folder;
            if (!fs.existsSync(dir)) fs.mkdirSync(dir);
            let filename = dir + id;
            if (isNotify) filename += ".no";

            console.log("save relay data:" + data)
            var ret = fs.writeFileSync(filename, data);

            fs.remove(Path.join(__dirname, "/tx/" + last_folder));
        }
        app.post(PREFIX + '/relay/save', (req, res) => {
            const IP = getClientIp(req);
            console.log("Save relay IP:", IP);
            save_pr(req.body, false);
            res.send({ err: 0 });
        })
        function get_pr(id, isNotify) {
            let filename = Path.join(__dirname, "/tx/" + today_folder + id);
            //log(id);
            if (isNotify) filename += ".no";
            try {
                let data = fs.readFileSync(filename);
                return data;
            } catch (e) {
                //log(e.message);
            }
            return null;
        }
        app.get(PREFIX + '/relay/get/:id', (req, res) => {
            const notify = req.query.notify ? true : false;
            let id = req.params['id'];
            let data = get_pr(id, notify);
            if (data) {
                return (data);
                return;
            }
            return ("404");
        })

        app.post(PREFIX + '/relay/notify', async (req, res) => {
            const result = req.body;
            console.log("got notify,result=", result);
            save_pr(req.body, true);
            if (result.ack_url) return ("200");
            else return ({ code: 0, message: "ok" });
        })
        app.get(PREFIX + '/nodes', async (_, res) => {
            const lib = await coinfly.create('bsv')
            const pkey = process.env.nodeKey ? await lib.getPublicKey(process.env.nodeKey) : "NotSet"
            const s = config.server
            const serverUrl = s.publicUrl//(s.https ? "https://" : "http://") + s.domain + (s.https ? "" : ":" + s.port)
            const nodes = await Nodes.listAllNodes()
            return (!s.hideFromList ? nodes.concat([{ id: serverUrl, pkey, weight: 50 }]) : nodes)
        })
        app.get(PREFIX + '/sub/:domain/', async (req, res) => {
            const domain = req.params['domain']
            const session = await createSession(req, res);
            db.subscribe(domain, session)
            req.on("close", () => {
                res.end()
                console.log("one sub closed")
            })
        })
        app.get(PREFIX + '/pubsub/sub/:topic', async (req, res) => {
            const topic = req.params['topic']
            const session = await createSession(req, res);
            indexers.pubsub.subscribe(topic, session)
            req.on("close", () => {
                res.end()
                console.log("one sub closed")
            })
        })
        app.get(PREFIX + '/pubsub/pub/:topic/:msg', async (req, res) => {
            const topic = req.params['topic']
            const msg = req.params['msg']
            indexers.pubsub.publish(topic, msg)
            return ({ code: 0 })
        })
        let handlingMap = {}
        app.get(PREFIX + '/notify', async function (req, res) {
            const { id, cmd, data } = req.query
            if (id && handlingMap[id]) {
                return ('done')
            }
            if (objLen(handlingMap) > 1000) self.handlingMap = {}
            handlingMap[id] = true
            const para = JSON.parse(data)
            if (cmd === 'publish') {
                indexers.pubsub.publish(para.topic, para.msg)
            }
            return ('ok')
        })
        app.get(PREFIX + '/p2p/:cmd/', async function (req, res) { //sever to server command
            const cmd = req.params['cmd']
            let ret = { code: 100 }
            if (cmd === 'ping') {
                if (req.query['sign']) {

                }
                ret.msg = "pong";
                ret.code = 0
            }
            if (cmd === "newtx") {
                const d = req.query['data'];
                const para = JSON.parse(d)
                const from = req.query['from']
                handleNewTx(para, from)
                ret.code = 0
            }
            if (cmd === "newnode") {
                const d = req.query['data'];
                const para = JSON.parse(d)
                Nodes.addNode(d)
                ret.code = 0
            }
            if (cmd === 'gettx') {
                const txid = req.query['txid']
                if (txid)
                    ret = db.getFullTx({ txid })
            }
            if (cmd === 'getdata') {
                ret = await db.readData(req.query['hash'], { string: req.query['string'] })
                if (ret.raw) ret.code = 0
                else ret = { code: 1, msg: "not found" }
            }
            if (cmd === 'backup') {
                ret = await db.backupDB()
            }
            if (cmd === 'getNewTx') {
                ret = await db.getNewTx(req.query)
            }
            return (ret)
        })


        app.get(PREFIX + '/nodeinfo', async (req, res) => {
            const { config } = this.indexers
            let info = { ...config.server, ...config.node_info, ...config.payment };
            info.version = "1.6." + fs.readFileSync(Path.join(__dirname, '/../../../build_number'), 'utf8').trim();
            info.tld = config.tld
            const lib = await coinfly.create('bsv')
            if (config.key)
                info.pkey = await lib.getPublicKey(config.key)
            info.statusHash = db.readConfig('txdb', 'statusHash')
            info.height = db.readConfig('txdb', 'height')
            info.chainid = config.chainid
            return (info);
        })
        app.get(PREFIX + `/tld`, function (req, res) {
            const { config } = indexers
            return (config.tld);
        });
        app.get(PREFIX + '/onSale', (req, res) => {
            return (db.getSellDomains())
        })
        app.get(PREFIX + '/queryTX', async (req, res) => {
            const fromTime = req.query['from']
            const toTime = req.query['to']
            const height = req.query['height']
            if (height) {
                return (await db.getBlockTxs(height))
            } else {
                return (await db.queryTX(fromTime ? fromTime : 0, toTime ? toTime : -1))
            }

        })
        app.get(PREFIX + '/getBlocks', async (req, res) => {
            const from = req.query['from']
            const to = req.query['to'] ? req.query['to'] : from

            const ret = db.getBlocks(from, to)
            return (ret)
        })

        app.get(PREFIX + '/admin', async (req, res) => {
            const cmd = req.query['cmd']
            if (!config.adminKey || config.adminKey != req.query['key']) {
                return ('no access 1')
            }
            switch (cmd) {
                case 'resetdb': db.resetDB(); break;
                case 'resetblocks': {
                    db.resetBlocks()
                    indexers.shutdown()
                    break;
                }
                case 'vacuum': await db.vacuumDB(req.query['name'])
                case 'pulltx': db.pullNewTx(100); break;
                case 'vdb': db.verifyTxDB(); break;
                case 'restoredm': db.restoreLastGoodDomainDB(); break;
                case 'pnpm': {
                    const result = Util.runNpmUpdate(indexers)
                    return (result)
                    return
                }
                case 'backup': {
                    db.backupDB(); break;
                }
                case 'update': {
                    const result = Util.runNodeUpdate(indexers)
                    return (result)
                    return;
                }
                case 'getDBInfo': {
                    let ret = db.getDBInfo(req.query.name)
                    return (ret)
                }
                case 'showtable': {
                    let ret = db.showTable(req.query.name, req.query.table)
                    return ret
                }
                case 'compactTXDB': {
                    db.compactTXDB(); break;
                }
                case 'execPreparedQuery': {
                    return db.API_execPreparedQuery({ name: "test", paras: ['NFZxNUx3YVZGeUM4Z1UzMyAGb/6Wte0vj5dzYO5h54SayACyJ6whFG/NubzP73rS'] })
                }
                case 'deletedb': {
                    return db.deleteDB({ name: req.query['name'] })
                }
                case 'deleteAsset': {
                    return db.deleteOldAsset()
                }
                case 'compactDMDB': {
                    return db.compactDMDB(req.query.name)
                }
                case 'pullNewDM': {
                    return db.pullNewDomains()
                }
            }

            //db.delKey("kkk.users.test.pv")
            // await db.saveKey({ key: "test", value: "11111111jjj111111111111", domain: "test.a", tags: { name: 'xx', cap: 123 }, ts: 123322222 })
            // await db.readKey("test.test.a")
            //await Util.downloadFile("https://api.nbdomain.com/files/bk_txs.db", Path.join(__dirname, "/test.db"))
            return ("ok")
        })

        app.post(PREFIX + '/execPreparedQuery', async (req, res) => {

            const t1 = Date.now()
            const { name, sql, paras, method, transform } = req.body
            const { apikey } = req.headers
            if (config.apikey && config.apikey.indexOf(apikey) === -1) {
                console.log("execPreparedQuery, no access")
                return { code: 100, msg: "no access" }
            }
            const ret = await db.API_execPreparedQuery({ name, sql, paras, method, transform })
            const t2 = Date.now()
            console.log("execPreparedQuery:", para, " time=", (t2 - t1) / 1000)
            return ret
        })
        app.post(PREFIX + '/getNewDm', async (req, res) => {
            return await db.getNewDm(req.body)
        })
        app.get(PREFIX + '/reverify', async (req, res) => {
            const txid = req.query['txid']
            const ret = db.getFullTx({ txid })
            const tx = ret.tx
            indexers.indexer.addTxFull({ txid: tx.txid, sigs: tx.sigs, rawtx: tx.rawtx, txTime: tx.txTime, force: true, chain: tx.chain })
            return ("ok")
        })
        app.get(PREFIX + '/dataCount', (req, res) => {
            return (db.getDataCount())
        })
        app.get(PREFIX + '/getData', async (req, res) => {
            const txid = req.query['txid']
            const ret = db.getFullTx({ txid })
            return (ret)
        })
        app.get(PREFIX + '/find_domain', async (req, res) => {
            var addr = req.query.address;
            let result = await db.findDomains({ address: addr });
            const arr = []
            result.forEach(item => {
                const dd = item.domain.split('.')
                arr.push({ nid: dd[0], tld: dd[1], domain: item.domain })
            })

            return ({
                code: 0,
                message: "OK",
                obj: arr
            })

        })
        app.get(PREFIX + '/findDomain', async (req, res) => {
            try {
                let addr = req.query.address, result = [];
                if (addr) {
                    const arrAdd = addr.split(',')
                    for (const addr of arrAdd) {
                        result.push({ address: addr, result: await db.findDomains({ address: addr }) });
                    }
                } else if (req.query.option) {
                    let option = JSON.parse(req.query.option)
                    result = db.findDomains(option);
                }
                return ({
                    code: 0,
                    message: "OK",
                    obj: result
                })
            } catch (err) {
                let resp = {
                    code: 99,
                    message: err.message
                };
                console.log(err);
                return (resp);
                return;
            }
        });


        //-----------------------Blockchain tools---------------------------------//
        app.get(PREFIX + '/tools/:chain/balance/:address', async (req, res) => {
            const address = req.params['address']
            const chain = req.params['chain']
            let addr = Util.parseJson(address)
            if (!addr) addr = address
            const ret = await Util.getBalance(addr, chain)
            return (ret)
        })
        app.get(PREFIX + '/tools/:chain/status/:txid', async (req, res) => {
            const txid = req.params['txid']
            const chain = req.params['chain']
            const ret = await Util.getTxStatus(txid, chain)
            return (ret)
        })
        app.get(PREFIX + '/tools/market/rates/:symbol', async (req, res) => {
            const symbol = req.params['symbol']
            const url = "https://api.huobi.pro/market/trade?symbol=" + symbol
            try {
                let ret = await axios.get(url)
                if (ret && ret.data) {
                    ret = ret.data.tick.data[0].price
                }
                return ({ [symbol]: ret })
            } catch (e) {
                return ({ err: e.message })
            }
        })
    }
}


module.exports = appModule