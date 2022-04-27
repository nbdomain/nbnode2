const { DomainTool } = require('./domainTool')
const { ERR, MemDomains, NIDObject } = require('./def')
const Parser = require('./parser')



const MAX_RESOLVE_COUNT = 10000

/**
   * Filter out private keys from object.
   * @param {object} data The object to filter.
   * @returns {object} the object with public keys only.
   */
function reduceKeys_(data, includeKeyUser) {

    let allowed = ['nid', 'owner_key', 'tld', 'owner', 'txid', 'status', 'admins', 'sell_info', 'has_unconfirmed', 'last_txid'];
    if (includeKeyUser) {
        allowed.push('users');
        allowed.push('keys');
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
    constructor(chain, database) {
        this.chain = chain
        this.db = database
        this.resolveNextBatchInterval = 5000
        this.resolveNextBatchTimerId = 0

        this.controllers = [] //control resolve switch

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
    readSubdomain(fullDomain, history = null) {
        let baseDomain, subDomain;
        const dd = fullDomain.split('.');
        if (dd.length < 2) return null;
        const lastAT = fullDomain.lastIndexOf('@');
        if (lastAT != -1 && dd.length == 2) { //an email like address
            baseDomain = fullDomain.slice(lastAT + 1);
            subDomain = fullDomain.slice(0, lastAT + 1); //includes @
            const ret = this.db.readUser(fullDomain)
            return ret ? { code: 0, domain: fullDomain, obj: { ...ret } } : null
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
                const subObj = this.db.readKey(fullDomain)
                if (subObj) {
                    let retObj = { code: 0, domain: fullDomain, obj: subObj }
                    return retObj;
                }
            }
        }
        return null;
    }
    async readDomain(fullDomain, forceFull, history = null) {
        fullDomain = fullDomain.toLowerCase()
        const dd = fullDomain.split('.')
        if (dd.length < 2) return null;
        let obj = null
        if (dd.length === 2) {
            if (fullDomain.indexOf('@') != -1) { //an email like address
                return this.readSubdomain(fullDomain);
            }
            obj = this.db.loadDomain(fullDomain)
            if (obj) {
                obj = reduceKeys_(obj, true)
                if (!forceFull) { //expand $truncated keys
                    for (const key in obj.keys) {
                        if (JSON.stringify(obj.keys[key].value.value) > 512) {
                            obj.keys[key].value.value = "$truncated"
                            obj.truncated = true
                        }
                    }
                }
                if (obj.nfts) {
                    for (let symbol in obj.nfts) {
                        if (this.db.getNFT(symbol)) continue
                        delete obj.nfts[symbol] //remove the non-exist nft
                    }
                }
                return { code: 0, obj: obj, domain: fullDomain }
            }
            let ret = await DomainTool.fetchDomainAvailibility(fullDomain);
            ret.domain = fullDomain;

            return ret.code == 0 ? { ...ret, code: 100 } : ret;
        }
        const ret = this.readSubdomain(fullDomain, history);
        if (ret) return ret;
        return { code: ERR.KEY_NOTFOUND, message: fullDomain + " not found" }

    }
    getDomainHistoryLen(domain) {
        return this.db.readKeyHistoryLen(domain)
    }
    async readNBTX(fromTime, toTime) {
        return await this.db.queryTX(fromTime, toTime, this.chain)
    }
    addController(controller) {
        this.controllers.push(controller)
    }
    async readUser(account) {
        const dd = account.split('@')
        if (dd.length < 2) return { code: 1, msg: "wrong account format" }
        if (dd[0].toLowerCase() === 'root') {
            const obj = await this.db.loadDomain(dd[1])
            return obj ? { code: 0, account: account, address: obj.owner, attributes: { publicKey: obj.owner_key } } : { code: 1, msg: dd[1] + " is not registered" }
        }
        const res = this.db.readUser(account)
        return { code: res ? 0 : 1, ...res }
    }
    async resolveNextBatch() {
        if (!this.started) return
        for (const controller of this.controllers) {
            if (!controller.canResolve()) {
                this.resolveNextBatchTimerId = setTimeout(this.resolveNextBatch.bind(this), this.resolveNextBatchInterval)
                return
            }
        }
        const rtxArray = await this.db.getUnresolvedTX(MAX_RESOLVE_COUNT, this.chain)
        const nidObjMap = MemDomains.getMap(this.chain)
        try {
            if (rtxArray == null || rtxArray.length == 0) {
                if (!this.firstFinish) {
                    console.warn(`--${this.chain}----Handled All current TX from DB-------`)
                    this.firstFinish = true
                    MemDomains.clearObj(this.chain); //release memory
                }
            } else {
                console.log("get ", rtxArray.length, " txs from DB")
                for (const item of rtxArray) {
                    try {
                        const rawtx = item.bytes && (this.chain == 'bsv' ? item.bytes.toString('hex') : item.bytes.toString())
                        delete item.bytes
                        if (!rawtx) {
                            console.log("found")
                            continue
                        }
                        this.db.setTransactionResolved(item.txid, this.chain)
                        const res = await Parser.get(this.chain).parseTX({ rawtx, height: item.height, time: item.time })
                        if (!res) continue
                        const rtx = { ...res.obj, ...item }
                        if (!rtx.output || rtx.output?.err) {
                            //console.error(item.txid, " parse error:", rtx.output?.err)
                            continue
                        }

                        let domain = rtx.output.domain
                        if (domain == "10200.test") {
                            console.log("found")
                        }
                        if (!(domain in nidObjMap)) {
                            let onDiskNid = this.db.loadDomain(domain, true)
                            if (!onDiskNid) {
                                nidObjMap[domain] = new NIDObject(domain)
                            } else {
                                nidObjMap[domain] = onDiskNid
                            }
                        }
                        const obj = await (Parser.get(this.chain).fillObj(nidObjMap[domain], rtx, nidObjMap))
                        if (obj) {
                            nidObjMap[domain] = obj
                            nidObjMap[domain].dirty = true
                        }
                    } catch (e) {
                        console.error(e);
                    }
                }

                for (let domain in nidObjMap) {
                    if (nidObjMap[domain].owner_key != null && nidObjMap[domain].dirty === true) {
                        console.log("saving:", domain)
                        delete nidObjMap[domain].dirty
                        this.db.saveDomainObj(nidObjMap[domain])

                    }
                }
            }

        } catch (err) {
            console.log(err)
        }
        this.resolveNextBatchTimerId = setTimeout(this.resolveNextBatch.bind(this), this.resolveNextBatchInterval)
    }
}
// ------------------------------------------------------------------------------------------------

module.exports = Resolver