const { DomainTool } = require('./domainTool')
const { ERR, MemDomains, NIDObject } = require('./def')
const Parser = require('./parser')
const { Util } = require('./util')



const MAX_RESOLVE_COUNT = 500

let wait = ms => new Promise(resolve => setTimeout(resolve, ms));
/**
   * Filter out private keys from object.
   * @param {object} data The object to filter.
   * @returns {object} the object with public keys only.
   */
function reduceKeys_(data, includeKeyUser) {

    let allowed = ['nid', 'owner_key', 'tld', 'owner', 'txid', 'status', 'admins', 'sell_info', 'has_unconfirmed', 'last_txid'];
    if (includeKeyUser) {
        allowed.push('users');
        //allowed.push('keys');
    }
    if (data.nfts) {
        allowed.push('nfts');
    }

    const filtered = Object.keys(data)
        .filter(key => allowed.includes(key) && (key in data))
        .reduce((obj, key) => {
            obj[key] = data[key];
            return obj;
        }, {});

    return filtered;
}


class Resolver {
    constructor(database, indexers) {

        this.db = database
        this.indexers = indexers
        this.resolveNextBatchInterval = 2000
        this.resolveNextBatchTimerId = 0
        this.controllers = [] //control resolve switch
        this.db.onResetDB = this.onResetDB;

    }
    start() {
        if (this.started) return
        this.started = true

        this.resolveNextBatch()
    }
    stop() {
        this.started = false
        clearTimeout(this.resolveNextBatchTimerId)
        this.pollForNewBlocksTimerId = null
    }
    onResetDB(type) {
        if (type == "domain") {

        }
    }
    findDomain(k, v) {
        let result = this.db.queryDomains(k, v);
        if (result == null) {
            return {};
        }
        const all = result.map(function (val) {
            let nidObj = reduceKeys_(JSON.parse(val.jsonString), false);
            return nidObj;
        });
        return all;
    }
    async readSubdomain(fullDomain, history = null) {
        let baseDomain, subDomain;
        const dd = fullDomain.split('.');
        if (dd.length < 2) return null;
        const lastAT = fullDomain.lastIndexOf('@');
        if (lastAT != -1 && dd.length == 2) { //an email like address
            baseDomain = fullDomain.slice(lastAT + 1);
            subDomain = fullDomain.slice(0, lastAT + 1); //includes @
            const ret = this.db.readUser(fullDomain)
            return ret ? { code: 0, domain: fullDomain, obj: { ...ret } } : { code: 1, msg: 'not found' }
        } else {
            baseDomain = dd[dd.length - 2] + '.' + dd[dd.length - 1];
            dd.pop(); dd.pop();
            subDomain = dd.join('.') + '.'; //incluses .
        }
        const obj = this.db.loadDomain(baseDomain)
        if (obj) {
            if (history) {
                const subObj = this.db.readKeyHistory(fullDomain, history)
                return subObj ? { code: 0, domain: fullDomain, obj: subObj } : null
            } else {
                const subObj = await this.db.readKey(fullDomain)
                if (subObj) {
                    let retObj = { code: 0, domain: fullDomain, obj: subObj }
                    return retObj;
                }
            }
        }
        return null;
    }
    async readDomain({ fullDomain, forceFull, history = null, price = true }) {
        fullDomain = fullDomain.toLowerCase()
        const dd = fullDomain.split('.')
        if (dd.length < 2) return null;
        let obj = null
        if (dd.length === 2) {
            if (fullDomain.indexOf('@') != -1) { //an email like address
                return await this.readSubdomain(fullDomain);
            }
            obj = this.db.loadDomain(fullDomain)
            if (obj) {
                obj = reduceKeys_(obj, true)
                if (forceFull) { // keys
                    const keysRet = this.db.getAllKeys(fullDomain)
                    obj.keys = keysRet ? keysRet : []
                }
                if (obj.nfts) {
                    for (let symbol in obj.nfts) {
                        if (this.db.getNFT(symbol)) continue
                        delete obj.nfts[symbol] //remove the non-exist nft
                    }
                }
                return { code: 0, obj: obj, domain: fullDomain }
            }
            let ret = price ? await DomainTool.fetchDomainPrice(fullDomain, this.db) : { code: 110 };
            ret.domain = fullDomain;

            return ret.code == 0 ? { ...ret, code: 100 } : ret;
        }
        const ret = await this.readSubdomain(fullDomain, history);
        if (ret) return ret;
        return { code: ERR.KEY_NOTFOUND, message: fullDomain + " not found" }

    }
    getDomainHistoryLen(domain) {
        return this.db.readKeyHistoryLen(domain)
    }
    async readNBTX(fromTime, toTime) {
        return await this.db.queryTX(fromTime, toTime)
    }
    addController(controller) {
        this.controllers.push(controller)
    }
    async readUser(account) {
        let res = {}
        const dd = account.split('@')
        if (dd.length < 2) return { code: 1, msg: "wrong account format" }
        if (dd[0].toLowerCase() === 'root') {
            const obj = await this.db.loadDomain(dd[1])
            if (!obj) return { code: 1, msg: dd[1] + " is not registered" }
            res = { code: 0, account: account, address: obj.owner, attributes: { publicKey: obj.owner_key } }
        } else {
            res = this.db.readUser(account)
        }
        if (!res.chain) {
            res.chain = Util.getchain(dd[1])
        }
        if (!res) return { code: 1 }
        if (!res.attributes.uid) {
            res.attributes.uid = await Util.dataHash(res.account + res.address)
        }
        return { code: 0, ...res }
    }
    async resolveNextBatch() {
        if (!this.started) return
        while (true) {


            for (const controller of this.controllers) {
                if (!controller.canResolve()) {
                    this.resolveNextBatchTimerId = setTimeout(this.resolveNextBatch.bind(this), this.resolveNextBatchInterval)
                    return
                }
            }
            const { logger } = this.indexers
            const rtxArray = this.db.getUnresolvedTX(MAX_RESOLVE_COUNT)
            //console.log("rtxArray:", rtxArray.length)
            const nidObjMap = MemDomains.getMap()
            try {
                if (rtxArray == null || rtxArray.length == 0) {
                    if (!this.resolveFinish) {
                        console.warn(`--$----Handled All current TX from DB-------`)
                        this.resolveFinish = true
                        MemDomains.clearObj(); //release memory

                    }
                } else {
                    console.log("get ", rtxArray.length, " txs from DB")
                    this.resolveFinish = false
                    for (const item of rtxArray) {
                        try {
                            const rawtx = item.bytes && (item.chain == 'bsv' ? item.bytes.toString('hex') : item.bytes.toString())
                            delete item.bytes
                            if (!rawtx) {
                                console.log("found")
                                continue
                            }
                            if (item.txid == "3a51d5baf6c186c26a85350f46c0df32a7435ed7f962791084aa62a5a9944201") {
                                console.log("found")
                            }
                            console.log("resolving:", item.txid)
                            this.db.setTransactionResolved(item.txid, item.txTime)


                            const res = await Parser.parseTX({ rawtx, height: item.height, time: item.txTime, chain: item.chain })
                            if (!res) continue
                            const rtx = { ...item, ...res.rtx }
                            if (!rtx.output || rtx.output?.err) {
                                //console.error(item.txid, " parse error:", rtx.output?.err)
                                continue
                            }

                            let domain = rtx.output.domain

                            if (!(domain in nidObjMap)) {
                                let onDiskNid = this.db.loadDomain(domain, true)
                                if (!onDiskNid) {
                                    nidObjMap[domain] = new NIDObject(domain)
                                } else {
                                    nidObjMap[domain] = onDiskNid
                                }
                            }
                            const obj = await Parser.fillObj(nidObjMap[domain], rtx, nidObjMap)
                            if (obj) {
                                //logger.logFile("processed:", item.txid)
                                nidObjMap[domain] = obj
                                nidObjMap[domain].dirty = true
                            }
                        } catch (e) {
                            console.error(e);
                        }
                    }
                    const sortedObj = []
                    for (const domain in nidObjMap) {
                        sortedObj.push(nidObjMap[domain])
                    }
                    sortedObj.sort((x, y) => {
                        if (x.domain < y.domain) { return -1; }
                        if (x.domain > y.domain) { return 1; }
                        return 0;
                    })
                    for (const item of sortedObj) {
                        if (item.owner_key != null && item.dirty === true) {
                            console.log("saving:", item.domain)
                            delete item.dirty
                            await this.db.saveDomainObj(item)
                        }
                    }
                }
            } catch (err) {
                console.log(err)
            }
            const waitTime = rtxArray.length == 0 ? 3000 : 500
            await wait(waitTime)
        }
    }
}
// ------------------------------------------------------------------------------------------------

module.exports = Resolver