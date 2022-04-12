const { DomainTool } = require('./domainTool')
const { ERR, CMD } = require('./def')
const Parser = require('./parser')



const MAX_RESOLVE_COUNT = 10000
let g_nidObjMap = {}

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

class NIDObject {
    constructor(domain) {
        this.domain = domain
        const ids = domain.split('.')
        if (ids.length < 2) throw ("NIDOBject init with:", domain)
        this.nid = ids[0]
        this.tld = ids[ids.length - 1]
        this.owner_key = null
        this.owner = null
        this.txid = 0
        this.status = 0
        this.expire = 0
        this.lastTxTs = 0
        this.keys = {}
        this.update_tx = {}
        this.tag_map = {}
        this.users = {}
        this.admins = []
        this.admin_update_tx = 0
        this.sell_info = null
        this.tf_update_tx = 0
        this.lastUpdateBlockId = 0
        this.last_txid = 0
    }
}

class Resolver {
    constructor(chain, database) {
        this.chain = chain
        this.db = database
        this.resolveNextBatchInterval = 5000
        this.resolveNextBatchTimerId = 0

    }
    static onResetDB(type) {
        if (type === 'domain') {
            g_nidObjMap = {}
        }
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
    async resolveNextBatch() {
        if (!this.started) return
        const rtxArray = await this.db.getUnresolvedTX(MAX_RESOLVE_COUNT, this.chain)

        try {
            if (rtxArray == null || rtxArray.length == 0) {
                if (!this.firstFinish) {
                    console.warn("------Handled All current TX from DB-------")
                    this.firstFinish = true
                    g_nidObjMap = {}; //release memory
                }
            } else {
                let lastResolvedId = 0;
                console.log("get ", rtxArray.length, " txs from DB")
                // Add transaction to Nid one by one in their creation order
                try {
                    for (const rtx of rtxArray) {
                        this.db.setTransactionResolved(rtx.txid, this.chain)
                        if (!rtx.output || !rtx.output.domain) continue
                        if (rtx.command == CMD.REGISTER && rtx.output.err) continue
                        let domain = rtx.output.domain
                        if (domain == "10200.test") {
                            console.log("found")
                        }
                        if (!(domain in g_nidObjMap)) {
                            let onDiskNid = this.db.loadDomain(domain)
                            if (!onDiskNid) {
                                g_nidObjMap[domain] = new NIDObject(domain)
                            } else {
                                g_nidObjMap[domain] = onDiskNid
                            }
                        }
                        //const obj = DomainTool.fillNIDFromTX(g_nidObjMap[domain], rtx)
                        const obj = await (Parser.get(this.chain).fillObj(g_nidObjMap[domain], rtx, g_nidObjMap))
                        if (obj) {
                            g_nidObjMap[domain] = obj
                            g_nidObjMap[domain].dirty = true
                        }
                        lastResolvedId = rtx.id
                    }



                } catch (e) {
                    console.error(e);
                }

                for (let domain in g_nidObjMap) {
                    if (g_nidObjMap[domain].owner_key != null && g_nidObjMap[domain].dirty === true) {
                        console.log("updating:", domain)
                        delete g_nidObjMap[domain].dirty
                        this.db.saveDomainObj(g_nidObjMap[domain])

                    }
                }
                //if (lastResolvedId != 0)
                //    this.db.saveLastResolvedId(lastResolvedId)
            }

        } catch (err) {
            console.log(err)
        }
        this.resolveNextBatchTimerId = setTimeout(this.resolveNextBatch.bind(this), this.resolveNextBatchInterval)
    }
}
// ------------------------------------------------------------------------------------------------

module.exports = Resolver