'use strict'

var _ = require('@yoda/util')._
var ota = require('@yoda/ota')
var system = require('@yoda/system')
var logger = require('logger')('otap')
var promisify = require('util')

var strings = require('./strings.json')

var getAvailableInfoAsync = promisify(ota.getAvailableInfo)

var intentHandler = {
  start_sys_upgrade: checkUpdateAvailability,
  check_sys_upgrade: checkUpdateAvailability,
  check_upgrade_num: whatsCurrentVersion
}

/**
 *
 * @param {YodaRT.Activity} activity
 */
module.exports = function (activity) {
  activity.on('request', function (nlp, action) {
    var intent = nlp.intent
    if (intent === 'RokidAppChannelForward') {
      intent = _.get(nlp, 'forwardContent.intent')
    }
    var handler = intentHandler[intent]
    if (handler == null) {
      return activity.tts.speak(strings.UNKNOWN_INTENT)
        .then(() => activity.exit())
    }
    logger.info(`OtaApp got nlp ${nlp.intent}`)
    handler(activity, nlp, action)
  })

  activity.on('url', function (url) {
    switch (url.pathname) {
      case '/mqtt/check_update':
        mqttCheckUpdate(activity)
        break
      case '/on_first_boot_after_upgrade':
        onFirstBootAfterUpgrade(activity, url)
        break
      case '/force_upgrade':
        forceUpgrade(activity, url)
        break
    }
  })
}

/**
 *
 * @param {YodaRT.Activity} activity
 */
function checkUpdateAvailability (activity) {
  logger.info('fetching available ota info')
  getAvailableInfoAsync().then(info => {
    if (info == null) {
      return activity.tts.speak(strings.NO_UPDATES_AVAILABLE)
        .then(() => activity.exit())
    }
    if (info.status !== 'downloaded') {
      ota.runInBackground()
      return activity.tts.speak(strings.UPDATES_DOWNLOADING)
        .then(() => activity.exit())
    }
    var result = isUpgradeSuitableNow()
    if (result !== true) {
      // TODO: device not available for upgrade
      return
    }
    logger.info(`using ota image ${info.imagePath}`)
    var ret = system.prepareOta(info.imagePath)
    if (ret !== 0) {
      return activity.tts.speak(strings.OTA_PREPARATION_FAILED)
        .then(() => activity.exit())
    }
    return activity.media.start('system://ota_start_update.ogg', { impatient: false })
      .then(() => system.reboot(), err => {
        logger.error('Unexpected error on announcing start update', err.stack)
        system.reboot()
      })
  }, error => {
    logger.error('Unexpected error on check available updates', error.stack)
    return activity.tts.speak(strings.NO_UPDATES_AVAILABLE)
      .then(() => activity.exit())
  })
}

/**
 *
 * @param {YodaRT.Activity} activity
 */
function whatsCurrentVersion (activity) {
  activity.tts.speak(strings.GENERIC_VERSION_ANNOUNCEMENT)
    .then(() => activity.exit())
}

function isUpgradeSuitableNow () {
  // TODO: check battery availability
  return true
}

/**
 *
 * @param {YodaRT.Activity} activity
 * @param {URL} url
 */
function onFirstBootAfterUpgrade (activity, url) {
  ota.resetOta(function onReset (err) {
    if (err) {
      logger.error('Unexpected error on reset ota', err.stack)
    }
  })
}

/**
 *
 * @param {YodaRT.Activity} activity
 * @param {URL} url
 */
function forceUpgrade (activity, url) {
  return activity.media.start('system://ota_force_update.ogg', { impatient: false })
    .then(() => system.reboot(), err => {
      logger.error('Unexpected error on announcing force update', err.stack)
      system.reboot()
    })
}

function mqttCheckUpdate (activity) {
  ota.getMqttOtaReport(function onReport (error, report) {
    if (error) {
      logger.error('mqtt check update', error)
      return
    }
    if (report.checkCode !== 0 && !report.updateAvailable) {
      ota.runInBackground()
    }
    activity.wormhole.sendToApp('sys_update_available', report)
  })
}
