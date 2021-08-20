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
    console.log("\n" + chalk.red("<login> -> ", text) + "\n");
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

async function query(query_object) {
  const rsp = await api(query_object);
  const text = await rsp.text();

  if (rsp.ok && text) {
    return csvToList(text);
  } else if (!text) {
    console.log(
      chalk.red(
        "<query> -> ",
        "查询不到相关信息:",
        JSON.stringify(query_object)
      )
    );
    return false;
  } else {
    console.log(chalk.red("<query> -> ", text));
    return false;
  }
}

async function parseFundList() {
  if (!(await fs.pathExists(FUNDS_PATH))) return false;

  const funds = await fs.readJson(FUNDS_PATH, { throws: false });
  if (!funds.length) return false;

  if (new Set(funds.map((i) => i.order_book_id)).size !== funds.length) {
    funds.forEach((fund, idx) => {
      if (
        funds.findIndex((i) => fund.order_book_id === i.order_book_id) !== idx
      ) {
        console.log(
          chalk.red("parseFundList -> ", fund.order_book_id, " 基金重复")
        );
      }
    });
    return false;
  }

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

  if (instruments?.length !== funds.length) {
    funds.forEach((fund) => {
      if (!instruments.some?.((i) => fund.order_book_id === i.order_book_id)) {
        console.log(
          chalk.red(
            "parseFundList -> ",
            "未查询到 instrument 信息 ",
            fund.order_book_id
          )
        );
      }
    });
    return false;
  }

  nav = nav.filter?.(
    (i, idx, arr) => i.order_book_id !== arr[idx + 1]?.order_book_id
  );

  if (nav?.length !== funds.length) {
    funds.forEach((fund) => {
      if (!nav.some?.((i) => fund.order_book_id === i.order_book_id)) {
        console.log(
          chalk.red(
            "parseFundList -> ",
            "未查询到 nav 信息 ",
            fund.order_book_id
          )
        );
      }
    });
    return false;
  }

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

  console.log(chalk.red("\n基金总资产: ", total, "元\n"));

  console.table(funds);

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

  console.log(chalk.red("\n基金中股票总资产: ", total, "元\n"));

  console.table(stocksDistribution);

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
