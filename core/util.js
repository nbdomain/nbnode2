/**
 * A helper class to manipulater BSV entities.
 */


const cp = require('child_process');
const nbpay = require('nbpay')
const fs = require('fs')
const arweave = require('arweave')
const CoinFly = require('coinfly');
const { blake3 } = require('hash-wasm')
const { default: axios } = require('axios');
const stream = require('stream');
const { promisify } = require('util');
const NBLib = require("nblib2");
const childProcess = require('child_process');
const LocalStorage = require('node-localstorage').LocalStorage;
Storage = new LocalStorage('./storage');
nbpay.auto_config();
let arLib = null, bsvLib = null;
CoinFly.create('ar').then(lib => arLib = lib)
CoinFly.create('bsv').then(lib => bsvLib = lib)
let SUB_PROTOCOL_MAP = null

class ArNodes {
    async _getPeers(seed) {
        const url = seed + '/health';
        try {
            const res = await axios.get(url);
            if (res.data) {
                let peers = []
                for (const item of res.data.origins) {
                    if (item.status == 200)
                        peers.push(item.endpoint)
                }
                return peers;
            }
        } catch (e) { console.error("_getPeers:", e.message) }
        return []
    }
    async init(seed) {
        this.nodes = [];
        this.iNode = 0;
        this.nodes.push("https://arweave.net")
        const data = await this._getPeers(seed);
        data.forEach((node) => {
            if (!node.startsWith('http')) node = 'http://' + node;
            this.nodes.push(node);
        });
        console.log("useable nodes:", this.nodes)
    }
    get() {
        this.iNode++;
        if (this.iNode >= this.nodes.length) this.iNode = 0
        const node = this.nodes[this.iNode];
        return node;
    }
}
const arNodes = new ArNodes()
arNodes.init("https://www.arweave.net")

class CMD_BASE {
    static parseTX(rtx) {
        let output = {}
        output.protocol = rtx.out[0].s2;
        output.nid = rtx.out[0].s3.toLowerCase();
        const tld = Util.getTLDFromRegisterProtocol(output.protocol)[0];
        output.domain = output.nid + "." + tld
        if (tld == null || output.nid.indexOf('.') != -1 || output.nid.indexOf('@') != -1)
            output.err = "Invalid NID"
        return output;

    }
};

class Util {
    static init(indexers) {
        this.indexers = indexers
        const { CONSTS } = this.indexers
        SUB_PROTOCOL_MAP = CONSTS.tld_config
    }
    static async initNBLib() {
        const { config, CONSTS } = this.indexers
        await NBLib.init({
            API: "http://localhost:" + config.server.port + "/api/",
            debug: true, //enable debug or not. 
            tld_config: CONSTS.tld_config,
            enable_write: false  //enable functions that can update and write value to NBdomain
        });
    }
    static async fetchDomainPrice(domain, db, newTx = false) {
        try {
            const { config, CONSTS, Nodes } = this.indexers
            await Util.initNBLib()
            const dd = domain.split('.')
            const tld = dd[dd.length - 1]
            const check_url = CONSTS.tld_config[tld].price_url
            if (!check_url) return { code: 0, price: 0 }
            const key = domain + ".prices"
            const obj = await db.loadDomain("priceinfo.a")
            if (obj && obj.keys[key]) {
                return { code: 0, price: obj.keys[key].value.price }
            }
            domain = encodeURIComponent(domain)
            const otherNode = Nodes.get({})
            if (otherNode) {
                try {
                    const url = otherNode + "/api/?nid=" + key + ".priceinfo.a"
                    console.log("getting price from:", url)
                    let res = await axios.get(url)
                    if (res.data && res.data.code == 0) return { code: 0, price: res.data.obj.v.price }
                } catch (e) {
                    console.error("fetchDomainPrice:", e.message)
                }
            }
            //let url = `${CONSTS.nidcheck_endpoint}${domain}?prereg=${newTx}`;
            console.log(`Sending request to URL ${check_url + domain}`);
            let res = await axios.get(check_url + domain, { timeout: 10000 });
            return res.data;
        } catch (error) {
            console.log(error);
            return { code: -1000, message: error };
        }
    }
    static async verifyTX(txs) {
        const bsvTX = txs.filter(tx => tx.chain === 'bsv').map(item => item.txid)
        const arTX = txs.filter(tx => tx.chain === 'ar').map(item => item.txid)
        let status = []
        if (bsvTX && bsvTX.length > 0) {
            status = await bsvLib.verifyTX(bsvTX)
        }
        if (arTX && arTX.length > 0) {
            status = await arLib.verifyTX(arTX)
        }

        return status
    }
    static async bitcoinSign(privateKey, data) {
        return await bsvLib.sign(privateKey, data)
    }
    static async verifyRaw({ expectedId, rawtx, chain }) {
        const lib = await CoinFly.create(chain)
        return await lib.verifyRaw({ expectedId, rawtx })
    }
    static async bitcoinVerify(publicKey, data, sig) {
        return await bsvLib.verify(publicKey, data, sig)
    }
    static toBuffer(data) {
        let buf = null
        if (Buffer.isBuffer(data)) {
            buf = data
        } else if (typeof data === 'string') {
            buf = Buffer.from(data, 'utf8')
        } else {
            buf = Buffer.from(data)
        }
        return buf
    }
    static async dataHash(data) {
        const buf = Util.toBuffer(data)
        const hash = await blake3(buf, 128)
        return hash
    }
    static parseJson(str) {
        try {
            return JSON.parse(str)
        } catch (e) {
        }
        return null
    }
    static parseKey(key) {
        const items = key.split('.')
        const len = items.length
        if (len < 2) return {}
        return { domain: items[len - 2] + '.' + items[len - 1], parent: items.slice(1).join('.'), tld: items[len - 1] }
    }
    static changeKeyname(o, oldKey, newKey) {
        if (oldKey === newKey || !o) return
        const d = Object.getOwnPropertyDescriptor(o, oldKey)
        if (d) Object.defineProperty(o, newKey, d);
        delete o[oldKey];
        for (const key in o) {
            if (typeof o[key] === 'object') {
                Util.changeKeyname(o[key], oldKey, newKey)
            }
        }
    }
    static getchain(domain) {
        let tld = null
        if (domain) {
            tld = domain.slice(domain.lastIndexOf('.') + 1)
        }
        if (tld) {
            for (let t in SUB_PROTOCOL_MAP) {
                if (tld == t) return SUB_PROTOCOL_MAP[t].chain ? SUB_PROTOCOL_MAP[t].chain : 'bsv'
            }
        }
        return null
    }
    static async addressFromPublickey(sPublic, chain = 'bsv') {
        const lib = await CoinFly.create(chain)
        return await lib.getAddress(sPublic)
    }
    static async getBalance(address, chain) {
        const lib = await CoinFly.create(chain)
        if (chain == 'bsv')
            return await lib.getBalance(address)
        if (chain == 'ar') {
            try {
                return await lib.getBalance(address)
            } catch (e) {
                let newAPI = arNodes.get()
                if (!newAPI) newAPI = "https://www.arweave.net"
                console.log("change ar api to:", newAPI)
                lib.changeNode(newAPI)
                return await lib.getBalance(address)
            }
        }
        return "wrong chain:" + chain
    }
    static async getTxStatus(txid, chain) {
        const lib = chain == "bsv" ? bsvLib : arLib
        return await lib.getTxStatus(txid)
    }
    /*static downloadFile(uri, filename) {
        console.log("downloading file from:", uri)
        let command = `curl -f -o ${filename}  '${uri}'`;
        cp.execSync(command, { stdio: 'inherit' });
    }*/

    static async downloadFile(fileUrl, outputLocationPath) {
        console.log("downloading file from:", fileUrl, "to:", outputLocationPath)
        const finished = promisify(stream.finished);
        const writer = fs.createWriteStream(outputLocationPath);
        return axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream',
        }).then(response => {
            response.data.pipe(writer);
            return finished(writer); //this is a Promise
        });
    }
    static runNpmUpdate(indexers) {
        try {
            const command = "pnpm i;pnpm update"
            let result = childProcess.execSync(command).toString();
            console.log("pnpm update:", result)
            setTimeout(() => indexers.shutdown(), 2000)
            return result
        } catch (e) {
            console.error(e.message)
            return e.message
        }
    }
    static runNodeUpdate(indexers) {
        try {
            const command = "git stash;git stash drop;git pull"
            let result = childProcess.execSync(command).toString();
            console.log("git pull:", result)
            if (result.slice(0, 7) !== "Already") {
                setTimeout(() => indexers.shutdown(), 2000)
            }
            return result
        } catch (e) {
            console.error(e.message)
            return e.message
        }
    }
    /**
     * Reset NidObject to initial state.
     * @param {NIDObject!} nidObj 
     * @param {!string} newOwner 
     * @param {!Number} newStatus 
     */
    static async resetNid(nidObj, newOwner, newOnwerTxid, newStatus, clearData, chain) {
        nidObj.owner_key = newOwner;
        if (newOwner != null) {
            nidObj.owner = await Util.addressFromPublickey(nidObj.owner_key, chain);
            nidObj.txid = newOnwerTxid;
        } else {
            nidObj.owner = null;
            nidObj.txid = 0;
        }
        nidObj.status = newStatus;
        if (clearData) {
            nidObj.admins = [];
            nidObj.keys = {};
            nidObj.users = {};
            nidObj.update_tx = {};
            nidObj.admin_update_tx = 0;
        }
        nidObj.tf_update_tx = 0
        delete nidObj.sell_info
        nidObj.dirty = true
        return nidObj;
    }
    static async sendRawtx(rawtx, chain = 'bsv') {
        let ret = { code: 1 }
        const lib = await CoinFly.create(chain)
        ret = await lib.send({ rawtx: rawtx })
        if (chain === 'ar' && ret.code != 0) {
            let newAPI = arNodes.get()
            if (!newAPI) newAPI = "https://www.arweave.net"
            console.log("change ar api to:", newAPI)
            lib.changeNode(newAPI)
            return await lib.send({ rawtx: rawtx })
        }
        return ret
    }
    static tsNowTime() {
        return Number(new Date().getTime());
    }
    static getAdmins(protocol, time) {
        let admins = [];
        for (let tld in SUB_PROTOCOL_MAP) {
            if (SUB_PROTOCOL_MAP[tld].address.protocol == protocol) {
                admins.push(SUB_PROTOCOL_MAP[tld].address.admin);
                let otherAdmins = SUB_PROTOCOL_MAP[tld].address.other_admins;
                if (time) {
                    for (let i = 0; i < otherAdmins.length; i++) {
                        if (time > otherAdmins[i].start_time && time <= otherAdmins[i].end_time) {
                            admins.push(otherAdmins[i].address);
                        }
                    }
                }
                return admins;
            }
        }
        return admins;
    }
    /**
    * Check if given string is valid (without TLD).
    * @param {!string} nid 
    */
    static isValidString(nid) {
        if (!nid || (typeof nid !== 'string') || (nid.length <= 0)) {
            return false;
        }
        const regex = /[a-zA-Z\d\-._~\!$()*+,;=]+/g;
        const found = nid.match(regex);
        return found;
    }
    static getTLDFromRegisterProtocol(register) {
        for (let tld in SUB_PROTOCOL_MAP) {
            let tldcfg = SUB_PROTOCOL_MAP[tld];
            if (tldcfg.address.protocol == register) {
                return [tld, tldcfg.address.payment];
            }
        }
        return [null, null];
    }

    static getRegisterProtocolFromPayment(payment) {
        for (let tld in SUB_PROTOCOL_MAP) {
            let tldcfg = SUB_PROTOCOL_MAP[tld];
            if (tldcfg.address.payment == payment) {
                return [tld, tldcfg.address.protocol];
            }
        }
        return [null, null];
    }
    static getPaymentAddr({ protocol, tld }) {
        if (protocol) {
            for (let tld in SUB_PROTOCOL_MAP) {
                if (SUB_PROTOCOL_MAP[tld].address.protocol == protocol) {
                    return SUB_PROTOCOL_MAP[tld].address.payment;
                }
            }
        }
        if (tld) {
            return SUB_PROTOCOL_MAP[tld].address.payment
        }
        return null;
    }
    static getProcotolFromTLD(tld) {
        if (SUB_PROTOCOL_MAP[tld]) {
            return SUB_PROTOCOL_MAP[tld].address.protocol;
        }
        return null;
    }
};

class ArUtil {
    static async getTxData(txid) {
        return await arweave.transactions.getData(txid, { decode: true, string: true })
    }
    static decode(str) {
        return this.fromB64Url(str)
    }
    static decodeTags(tags) {
        let ts = {}
        try {
            for (let tag of tags) {
                const t = ArUtil.utf8DecodeTag(tag)
                ts[t.name] = t.value
            }
            return ts
        } catch (e) {
            return tags
        }
    }
    static fromB64Url(input) {
        const paddingLength = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);

        const base64 = input
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .concat('='.repeat(paddingLength));

        return Buffer.from(base64, 'base64');
    }
    static isValidUTF8(buffer) {
        return Buffer.compare(Buffer.from(buffer.toString(), 'utf8'), buffer) === 0;
    };
    static utf8DecodeTag(tag) {
        let name;
        let value;
        try {
            const nameBuffer = ArUtil.fromB64Url(tag.name);
            if (ArUtil.isValidUTF8(nameBuffer)) {
                name = nameBuffer.toString('utf8');
            }
            const valueBuffer = ArUtil.fromB64Url(tag.value);
            if (ArUtil.isValidUTF8(valueBuffer)) {
                value = valueBuffer.toString('utf8');
            }
        } catch (error) { }
        return {
            name,
            value,
        };
    };
}
module.exports = { ArUtil, Util, CMD_BASE, NBLib }
