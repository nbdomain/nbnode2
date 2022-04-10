const TIMEOUT = 20000
const MEMPOOL_EXPIRATION = 60 * 60 * 24

require('axios').default.defaults.timeout = TIMEOUT

const CONSTS = {
    API: {
        bsv: "planaria", ar: 'arnode'
    },  // 'planaria','mattercloud','urchain','nbnode'
    PLANARIA_TOKEN: "eyJhbGciOiJFUzI1NksiLCJ0eXAiOiJKV1QifQ.eyJzdWIiOiIxQzc5M0RkVjI0Q3NORTJFUDZNbVZmckhqVlNGVmc2dU4iLCJpc3N1ZXIiOiJnZW5lcmljLWJpdGF1dGgifQ.SUJlYUc2TGNGdFlZaGk3amxwa3ZoRGZJUEpFcGhObWhpdVNqNXVBbkxORTdLMWRkaGNESC81SWJmM2J1N0V5SzFuakpKTWFPNXBTcVJlb0ZHRm5uSi9VPQ",
    NODEKEY: 'S3dFUFdBVmhvQVVhaGV2a3pyYm9UNm9pSEZDeWU5c0JUa2phZDJoZmU4blRIdGlSVXpiUw==',
    TXDB: 'txs.db',
    DMDB: 'domains.db',
    WORKERS: 4,
    FETCH_LIMIT: 20,
    START_HEIGHT: {
        bsv: 608410, ar: 858281
    },
    node_info: {
        prices: {
            domainHost: { bsv: 1000, ar: 1000 }, //host user's triditional domain and link to a nbdomain
            keyUpdate: { bsv: 2.0, ar: 4.0, fee: 0.5 },
            sellFee: 0.1,
        },
    },
    "proxy_map": {
        "/api/": "api",
        "/web/": "web",
        '/admin/': "admin"
    },
    "nidcheck_endpoint": "https://util.nbsite.link/namecheck/v1/check/",
    "admin": {
        "transfer_fee": 1000,
        "transfer_fee_rate": 0.1
    },
    "tld_config": {
        "test": {
            "testing": true,
            "chain": "bsv",
            "address": {
                "payment": "19fLpT5LpaMGKuLfUVqmNdXkVceq2rbjyn",
                "protocol": "1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5",
                "admin": "1KEjuiwj5LrUPCswJZDxfkZC8iKF4tLf9H",
                "other_admins": [
                    {
                        "address": "1PuMeZswjsAM7DFHMSdmAGfQ8sGvEctiF5",
                        "start_block": 0,
                        "end_block": 658652
                    },
                ]
            },
        },
        "b": {
            "chain": "bsv",
            "address": {
                "payment": "15Cww7izEdyr8QskJmqwC5ETqWREZCjwz4",
                "protocol": "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ",
                "admin": "14PML1XzZqs5JvJCGy2AJ2ZAQzTEbnC6sZ",
                "other_admins": []
            },
        },
        "a": {
            "chain": "ar",
            "address": {
                "payment": "gOyqCZBB-JmX1eDcYrIPPV71msTBBzPKwnEF3oEB-ZQ",
                "protocol": "ardomaina",
                "admin": "gOyqCZBB-JmX1eDcYrIPPV71msTBBzPKwnEF3oEB-ZQ",
                "other_admins": []
            },
        }
    }
}
module.exports = CONSTS