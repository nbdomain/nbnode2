const coinfly = require('coinfly')
const parseArgs = require('minimist')

async function createKeys(chain, format) {
    if (chain === 'bitcoin') chain = 'bsv'
    const bsvlib = await coinfly.create(chain)
    const p = await bsvlib.createPrivateKey(format)
    const pub = await bsvlib.getPublicKey(p)
    const address = await bsvlib.getAddress(pub)
    console.log("PrivateKey:", p, "\nPublicKey:", pub, "\nAddress:", address)
}
var myArgs = process.argv.slice(2);
if (myArgs && myArgs.length > 0) {
    var argv = parseArgs(myArgs, opts = {})
    console.log(argv)
    if (argv._[0] === 'key' && argv.c) {
        createKeys(argv.c, argv.f)
    }
} else {
    console.log(`Usage:\n
                 node tool [command] [arguments]\n
                 Commands:\n
                 key (crypto key related)\n
                 \t -c [ar|bitcoin]\t\tcreate private/public keys,eg: key -c ar`)
}