#!/usr/bin/env zx

import * as lib from "./lib.mjs";

$.verbose = false;

console.log(
  chalk.bgGreen.black(
    `\nwelcome to fund distributution ${new Date().toLocaleString()} >>\n`
  )
);

if (argv.h || argv.help) {
  lib.printUsage();
  process.exit(0);
}

if (!(await lib.isLogin())) {
  if (!(await lib.login())) {
    process.exit(1);
  }
}

const fundWithMyAssets = await lib.parseFundList();

if (!fundWithMyAssets) {
  lib.printUsage();
  process.exit(1);
}

lib.printStocksDistribution(fundWithMyAssets);
