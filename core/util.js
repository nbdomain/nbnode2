/**
 * A helper class to manipulater BSV entities.
 */


const bsv = require('bsv');
const { CONFIG } = require('./config');
const axios = require('axios');
const cp = require('child_process');
const nbpay = require('nbpay')
const AWNode = require('./arweave')
nbpay.auto_config();

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
    static  downloadFile(uri, filename){
        console.log("downloading file from:",uri)
        let command = `curl -o ${filename}  '${uri}'`;
        let result = cp.execSync(command,{stdio: 'inherit'});
        return result
    }
    /**
     * Reset NidObject to initial state.
     * @param {NIDObject!} nidObj 
     * @param {!string} newOwner 
     * @param {!Number} newStatus 
     */
    static resetNid(nidObj, newOwner, newOnwerTxid, newStatus, clearData = true) {
        nidObj.owner_key = newOwner;
        if (newOwner != null) {
            nidObj.owner = Util.getAddressFromPublicKey(nidObj.owner_key);
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
    static async sendRawtx(rawtx,blockchain='bsv') 
    {   
        let ret = {code:1}
        if(blockchain=='bsv'){
            const res =  await nbpay.send({tx:rawtx})
            ret = {code:res.err?1:0,...res}
            return ret
        }
        if(blockchain=='ar'){
            const res =  await AWNode.sendRawTx(rawtx)
            return res
        }
        throw("sendRawtx:unsupported blockchain")
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

module.exports = { Util, CMD_BASE }
