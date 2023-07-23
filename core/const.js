const TIMEOUT = 20000
const MEMPOOL_EXPIRATION = 60 * 60 * 24

require('axios').default.defaults.timeout = TIMEOUT

const CONSTS = {
    TXDB: 'txs.db',
    DMDB: 'domains.db',
    "modules": {
        "/api": "api",
        //'/web': "web",
        "/chain": "chain"
    },
    "admin": {
        "transfer_fee": 1000,
        "transfer_fee_rate": 0.1
    },
}
module.exports = CONSTS