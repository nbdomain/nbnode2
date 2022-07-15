const ERR = {
    NO_ERROR: 0,
    UNKNOWN: -1000,
    INVALID_OWNER: 10,
    INVALID_REGISTER: 12,
    PERMISSION_DENIED: 13,
    DOMAIN_NOT_VALID: 14,
    DOMAIN_NOT_AVAILALE: 15,
    NOTFOUND: 100,
    DOMAIN_RESERVED: 101,
    KEY_NOTFOUND: 102
};
const CMD = {
    "REGISTER": "register",
    "KEY": "key",
    "USER": "user",
    "ADMIN": "admin",
    "SELL": "sell",
    "BUY": "buy",
    "TRANSFER": "transfer",
    "NOP": "nop",
    "MAKE_PUBLIC": "make_public",
    "PAY_REGISTER": "pay_register",
    "PAY_BUY": "pay_buy",
    NFT_CREATE: "nft.create",
    NFT_TRANSFER: "nft.transfer",
    NFT_SELL: "nft.sell",
    NFT_BUY: "nft.buy",
    NFT_REFILL: "nft.refill"
};
const DEF = {
    BLOCK_SIGNATURE_UPDATE: 637628,
    STATUS_EXPIRED: 0x00,
    STATUS_VALID: 0x01,
    STATUS_TRANSFERING: 0x11,  // (code:17)
    STATUS_PUBLIC: 0x10,

    TX_INVALIDTX: 1, //MARK an invalid tx
    TX_FORMAT2: 2,

    BLOCK_VER: 6,       //block format
    BLOCK_TIME: 5000,   //consense time
    CONSENSUE_COUNT: 3, //number of nodes needed a node connects to
    MAX_BLOCK_LENGTH: 100 //max transaction in a block
}

class NIDObject {
    constructor(domain) {
        this.domain = domain;
        const ids = domain.split(".");
        if (ids.length < 2) throw ("NIDOBject init with:", domain);
        this.nid = ids[0];
        this.tld = ids[1];
        this.owner_key = null;
        this.owner = null;
        this.txid = 0;
        this.status = DEF.STATUS_EXPIRED;
        this.expire = 0;
        this.keys = {};
        this.key_update_tx = {};
        this.tag_map = {};
        this.users = {};
        this.user_update_tx = {};
        this.admins = [];
        this.admin_update_tx = 0;
        this.nft_log = {};
        this.udpate
        this.tf_update_tx = 0;
        this.last_txid = 0;
        this.truncated = false;
        this.last_txid = 0
        this.last_ts = 0
        this.last_cmd = null
    }
};
class MemDomains {
    static getMap() {
        if (!this.objs) this.objs = {}
        return this.objs
    }
    static get(domain) {
        if (!this.objs) return null
        return this.objs[domain]
    }
    static clearObj() {
        if (this.objs) {
            for (const key in this.objs) {
                delete this.objs[key]
            }
        }
    }
}
module.exports = {
    ERR, CMD, MemDomains, NIDObject, DEF
}