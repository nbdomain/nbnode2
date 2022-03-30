/**
 * A helper class to manipulater BSV entities.
 */


const bsv = require('bsv');
const { CONFIG } = require('./config');
const cp = require('child_process');
const nbpay = require('nbpay')
const arweave = require('arweave')
const CoinFly = require('coinfly')
nbpay.auto_config();
let arLib = null, bsvLib = null;
CoinFly.create('ar').then(lib=>arLib = lib)
CoinFly.create('bsv').then(lib=>bsvLib = lib)
const SUB_PROTOCOL_MAP = CONFIG.tld_config

class CMD_BASE {
    static parseTX(rtx) {
        let output = {}
        
            output.protocol = rtx.out[0].s2;
            output.nid = rtx.out[0].s3.toLowerCase();
            output.domain = output.nid + "." + Util.getTLDFromRegisterProtocol(output.protocol)[0];
            if (output.nid.indexOf('.') != -1 || output.nid.indexOf('@') != -1)
                output.err = "Invalid NID"
            return output;
        
    }
};

class Util {
   
    static parseJson(str){
        try{
            return JSON.parse(str)
        }catch(e){
        }
        return null
    }
    static getchain(domain){
        let tld = null
        if(domain){
            tld = domain.slice(domain.lastIndexOf('.')+1)
        }
        if(tld){
            for (let t in SUB_PROTOCOL_MAP) {
                if(tld==t)return SUB_PROTOCOL_MAP[t].chain?SUB_PROTOCOL_MAP[t].chain:'bsv'
            }
        }
        return null
    }
    static async addressFromPublickey(sPublic,chain='bsv'){
        const lib = await CoinFly.create(chain)
        return await lib.getAddress(sPublic)
    }
    static async getBalance(address,chain){
        const lib = chain=="bsv"?bsvLib:arLib
        return await lib.getBalance(address)
    }
    static async getTxStatus(txid,chain){
        const lib = chain=="bsv"?bsvLib:arLib
        return await lib.getTxStatus(txid)
    }
    static  downloadFile(uri, filename){
        console.log("downloading file from:",uri)
        let command = `curl -f -o ${filename}  '${uri}'`;
        try{
            let result = cp.execSync(command,{stdio: 'inherit'});
            return result
        }catch(e){
            console.error(e.message)
            return false
        }
    }
    /**
     * Reset NidObject to initial state.
     * @param {NIDObject!} nidObj 
     * @param {!string} newOwner 
     * @param {!Number} newStatus 
     */
    static async resetNid(nidObj, newOwner, newOnwerTxid, newStatus, clearData,chain) {
        nidObj.owner_key = newOwner;
        if (newOwner != null) {
            nidObj.owner = await Util.addressFromPublickey(nidObj.owner_key,chain);
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
        nidObj.sell_info = null;
        return nidObj;
    }
    static async sendRawtx(rawtx,chain='bsv') 
    {   
        let ret = {code:1}
        const lib = await CoinFly.create(chain)
        return await lib.send({rawtx:rawtx})
    }
    static tsNowTime() {
        return Number(new Date().getTime());
    }
    static getAdmins(protocol, blockId) {
        let admins = [];

        for (let tld in SUB_PROTOCOL_MAP) {
            if (SUB_PROTOCOL_MAP[tld].address.protocol == protocol) {
                admins.push(SUB_PROTOCOL_MAP[tld].address.admin);
                let otherAdmins = SUB_PROTOCOL_MAP[tld].address.other_admins;
                if (blockId) {
                    for (let i = 0; i < otherAdmins.length; i++) {
                        if (blockId > otherAdmins[i].start_block && blockId <= otherAdmins[i].end_block) {
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
    /**
     * Get PrivateKey from string.
     * @param {!string} privateKey User private key in string.
     * @returns {PrivateKey} User's private key object.
     */
    static getPrivateKey(privateKey) {
        return bsv.PrivateKey(privateKey);
    }

    /**
     * Generate user public key from his private key object.
     * @param {!PrivateKey} privateKey The private key of a user.
     * @return {!PublicKey} Public key of the user.
     */
    static getPublicKey(privateKey) {
        return bsv.PublicKey(privateKey);
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
    static getPaymentAddr(protocol) {
        for (let tld in SUB_PROTOCOL_MAP) {
            if (SUB_PROTOCOL_MAP[tld].address.protocol == protocol) {
                return SUB_PROTOCOL_MAP[tld].address.payment;
            }
        }
        return null;
    }
    /**
     * Get Address from public key.
     * @param {string} publicKey public key of a user.
     * @returns {string} Address of given user.
     */
    static getAddressFromPublicKey(publicKey) {
        if (publicKey == null || publicKey == "") {
            return null;
        }
        return bsv.Address.fromPublicKey(bsv.PublicKey.fromString(publicKey)).toString();
    }
    static getProcotolFromTLD(tld) {
        if (SUB_PROTOCOL_MAP[tld]) {
            return SUB_PROTOCOL_MAP[tld].address.protocol;
        }
        return null;
    }
    static getInputAddressFromTx(txHash) {
        try {
            let tx = new bsv.Transaction(txHash);
            return tx.inputs[0].script.toAddress().toString();
        } catch (err) {
            return null;
        }
    }

    static getPublicKeyFromRegTx(txHash) {
        try {
            let tx = new bsv.Transaction(txHash);
            return tx.inputs[0].script.chunks[1].buf.toString('hex');
        } catch (err) {
            return null;
        }
    }

    static validPublicKey(pubKey) {
        try {
            let key = bsv.PublicKey.fromString(pubKey);
            return true;
        } catch (err) {
            // pass
        }
        return false;
    }
};

class ArUtil{
    static async getTxData(txid){
        return await arweave.transactions.getData(txid, {decode: true, string: true})
    }
    static decode(str){
        return this.fromB64Url(str)
    }
    static decodeTags(tags){
        let ts = {}
        try{
            for(let tag of tags){
                const t = ArUtil.utf8DecodeTag(tag)
                ts[t.name] = t.value
            }
            return ts
        }catch(e){
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
module.exports = { ArUtil,Util, CMD_BASE }
