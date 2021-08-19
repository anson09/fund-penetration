const TOKEN_PATH = "./token";
const FUNDS_PATH = "./funds.json";
const HALF_MONTH = 15 * 24 * 60 * 60 * 1000;

function printUsage() {
  console.log(
    chalk.dim("configing your fund info in funds.json, example content:\n") +
      chalk.dim("- ".repeat(20)) +
      chalk.blue(
        '\n[{"order_book_id":"005827", "shares":10000}, {"order_book_id":"001668", "shares":999 }]\n'
      ) +
      chalk.dim("- ".repeat(20))
  );
}

async function isLogin() {
  if (await fs.pathExists(TOKEN_PATH)) {
    const rsp = await api({ method: "user.get_quota" });
    if (rsp.ok) {
      return true;
    }
  }
  return false;
}

async function login() {
  const user_name = (await question("enter your user name:")).trim();
  const password = (await question("enter your password:")).trim();

  const rsp = await fetch("https://rqdata.ricequant.com/auth", {
    method: "post",
    body: JSON.stringify({ user_name, password }),
  });
  const text = await rsp.text();

  if (rsp.ok) {
    await fs.outputFile(TOKEN_PATH, text);
    return true;
  } else {
    console.log("\n" + chalk.red(text) + "\n");
    return false;
  }
}

async function api(query_object) {
  return fetch("https://rqdata.ricequant.com/api", {
    method: "post",
    body: JSON.stringify(query_object),
    headers: { token: await fs.readFile(TOKEN_PATH, "utf8") },
  });
}

function csvToList(csv) {
  const lines = csv.split("\n").filter((i) => i !== "");
  const titles = lines.shift().split(",");

  return lines.map((l) =>
    l
      .split(",")
      .reduce((pre, cur, idx) => Object.assign(pre, { [titles[idx]]: cur }), {})
  );
}

async function printJsonTable(json) {
  if (!json?.[0]) return false;

  const titles = Object.keys(json[0]);
  const csv =
    titles.join(",") +
    "\n" +
    json
      .map((i) =>
        titles.reduce((pre, cur) => (pre += i[cur] + ","), "").slice(0, -1)
      )
      .join("\n");

  await $`echo ${csv}|column -s, -t`.pipe(process.stdout);

  return true;
}

async function query(query_object) {
  const rsp = await api(query_object);
  const text = await rsp.text();

  if (rsp.ok && text) {
    return csvToList(text);
  } else {
    console.log(chalk.red(text));
    return false;
  }
}

async function parseFundList() {
  if (!(await fs.pathExists(FUNDS_PATH))) return false;

  const funds = await fs.readJson(FUNDS_PATH, { throws: false });
  if (!funds) return false;

  let [instruments, nav] = await Promise.all([
    query({
      method: "fund.instruments",
      order_book_ids: funds.map((i) => i.order_book_id),
    }),
    query({
      method: "fund.get_nav",
      fields: "unit_net_value",
      start_date: new Date(
        new Date().getTime() - HALF_MONTH
      ).toLocaleDateString(),
      order_book_ids: funds.map((i) => i.order_book_id),
    }),
  ]);

  nav = nav.filter(
    (i, idx, arr) => i.order_book_id !== arr[idx + 1]?.order_book_id
  );

  funds.map((fund) =>
    Object.assign(
      fund,
      {
        symbol: instruments.find((i) => i.order_book_id === fund.order_book_id)
          .symbol,
      },
      nav.find((i) => i.order_book_id === fund.order_book_id)
    )
  );

  funds.map((i) =>
    Object.assign(i, { assets: Math.round(i.shares * i.unit_net_value) })
  );

  const total = funds.reduce((pre, cur) => (pre += cur.assets), 0);

  console.log(chalk.red("\n基金总资产：", total, "元\n"));

  printJsonTable(funds);

  return funds;
}

async function printStocksDistribution(funds) {
  if (!funds) return false;

  const holdings = await query({
    method: "fund.get_holdings",
    order_book_ids: funds.map((i) => i.order_book_id),
    date: new Date().toLocaleDateString(),
  });

  const assetsByID = {};

  funds.forEach((fund) => (assetsByID[fund.order_book_id] = fund.assets));

  const stocks = holdings
    .filter((i) => i.type === "Stock")
    .map((stock) => ({
      order_book_id: stock.order_book_id,
      symbol: stock.symbol,
      assets: Math.round(assetsByID[stock.fund_id] * stock.weight),
    }));

  const stocksByID = {};

  stocks.forEach((stock) => {
    if (stocksByID.hasOwnProperty(stock.order_book_id)) {
      stocksByID[stock.order_book_id].push(stock);
    } else {
      stocksByID[stock.order_book_id] = [stock];
    }
  });

  const stocksDistribution = Object.values(stocksByID)
    .map((stockList) =>
      stockList.reduce((pre, cur) =>
        Object.assign(pre, { assets: pre.assets + cur.assets })
      )
    )
    .sort((i, j) => j.assets - i.assets);

  const total = stocksDistribution.reduce((pre, cur) => (pre += cur.assets), 0);

  console.log(chalk.red("\n基金中股票总资产：", total, "元\n"));

  printJsonTable(stocksDistribution);

  return true;
}

export {
  printUsage,
  isLogin,
  login,
  api,
  query,
  parseFundList,
  printStocksDistribution,
};
