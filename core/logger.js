const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const util = require('util')
const combineMessageAndSplat = () => {
    return {
        transform: (info, opts) => {
            //combine message and args if any
            info.message = util.format(info.message, ...info[Symbol.for('splat')] || [])
            return info;
        }
    }
}

class Logger {
    init(gl) {
        //const __dirname = new URL('.', import.meta.url).pathname
        const { config } = gl
        const logFormat = winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            //winston.format.align(),
            combineMessageAndSplat(),
            winston.format.printf(
                info => `${info.timestamp} ${info.level}: ${info.message}`,
            ),);
        const transport = new DailyRotateFile({
            filename: gl.dataFolder + '/logs/' + (config.logfile || "nbnode-%DATE%.log"),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            //maxSize: '20m',
            maxFiles: '5d',
            prepend: true,
            level: config?.log?.level || 'info',
        });
        transport.on('rotate', function (oldFilename, newFilename) {
            // call function like upload to s3 or on cloud
        });
        this.logger = winston.createLogger({
            format: logFormat,
            transports: [
                transport,
                new winston.transports.Console({
                    level: "info",
                }),
            ]
        });
    }
    info(...argc) {
        this.logger.log('info', ...argc)
    }
    error(...argc) {
        this.logger.log('error', ...argc)
    }
    console(...argc) {
        console.log(...argc)
    }
}
module.exports = Logger