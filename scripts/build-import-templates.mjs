import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const artifactToolPath =
  "C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";
const { SpreadsheetFile, Workbook } = await import(pathToFileURL(artifactToolPath).href);

const outputDir = "outputs/import-templates-2026-08-28";
await fs.mkdir(outputDir, { recursive: true });

const headerFill = "#0F172A";
const hintFill = "#E0F2FE";
const warningFill = "#FEF3C7";
const border = { preset: "outside", style: "thin", color: "#CBD5E1" };

function styleHeader(range) {
  range.format = {
    fill: headerFill,
    font: { bold: true, color: "#FFFFFF" },
    borders: { preset: "all", style: "thin", color: "#334155" },
  };
}

async function saveWorkbook(workbook, filename, previewSheet) {
  const inspect = await workbook.inspect({
    kind: "workbook,sheet,table",
    maxChars: 4000,
    tableMaxRows: 5,
    tableMaxCols: 8,
  });
  await fs.writeFile(`${outputDir}/${filename}.inspect.ndjson`, inspect.ndjson ?? String(inspect), "utf8");
  const preview = await workbook.render({
    sheetName: previewSheet,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(`${outputDir}/${filename}.png`, new Uint8Array(await preview.arrayBuffer()));
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(`${outputDir}/${filename}.xlsx`);
}

function buildCrmWorkbook() {
  const workbook = Workbook.create();
  const leads = workbook.worksheets.add("CRM匯入");
  const guide = workbook.worksheets.add("使用說明");
  const lists = workbook.worksheets.add("選單資料");

  leads.showGridLines = false;
  guide.showGridLines = false;
  lists.showGridLines = false;

  const headers = [
    "姓名",
    "Email",
    "手機",
    "來源",
    "狀態",
    "標籤",
    "備註",
    "專案代碼",
    "負責顧問",
    "建立日期",
  ];
  leads.getRange("A1:J1").values = [headers];
  leads.getRange("A2:J5").values = [
    ["王小明", "example@example.com", "0900000000", "Google表單", "新名單", "高意願,待追蹤", "這裡放客戶備註", "P01", "顧問姓名", "2026-08-28"],
    ["", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", ""],
  ];
  styleHeader(leads.getRange("A1:J1"));
  leads.getRange("A1:J5").format.borders = { preset: "all", style: "thin", color: "#CBD5E1" };
  leads.getRange("A:J").format.columnWidthPx = 135;
  leads.getRange("F:G").format.columnWidthPx = 190;
  leads.getRange("J:J").setNumberFormat("yyyy-mm-dd");
  leads.freezePanes.freezeRows(1);
  leads.tables.add("A1:J5", true, "CRMImportTable");

  lists.getRange("A1:C1").values = [["來源", "狀態", "常用標籤"]];
  lists.getRange("A2:C8").values = [
    ["Google表單", "新名單", "高意願"],
    ["測驗系統", "待追蹤", "待追蹤"],
    ["預約系統", "已預約", "待回覆"],
    ["活動報名", "已完成", "企業包班"],
    ["手動匯入", "已淘汰", "課程名單"],
    ["其他", "拒絕名單", "已付款"],
    ["", "等候名單", "未預約"],
  ];
  styleHeader(lists.getRange("A1:C1"));
  lists.getRange("A:C").format.columnWidthPx = 140;

  leads.getRange("D2:D200").dataValidation = { rule: { type: "list", formula1: "選單資料!$A$2:$A$7" } };
  leads.getRange("E2:E200").dataValidation = { rule: { type: "list", formula1: "選單資料!$B$2:$B$8" } };

  guide.getRange("A1:E1").merge();
  guide.getRange("A1").values = [["CRM 匯入格式檔"]];
  guide.getRange("A1").format = { fill: headerFill, font: { bold: true, color: "#FFFFFF", size: 14 } };
  guide.getRange("A3:E8").values = [
    ["欄位", "是否必填", "填寫方式", "範例", "說明"],
    ["姓名", "必填", "文字", "王小明", "CRM 名單主名稱。"],
    ["Email / 手機", "至少一個", "文字", "example@example.com / 0900000000", "用於合併重複名單與後續聯絡。"],
    ["來源", "建議填", "下拉選單", "Google表單", "可用於篩選名單來源。"],
    ["狀態", "建議填", "下拉選單", "待追蹤", "匯入後可再批次更新。"],
    ["標籤", "選填", "逗號分隔", "高意願,待追蹤", "多個標籤用逗號分開。"],
  ];
  styleHeader(guide.getRange("A3:E3"));
  guide.getRange("A3:E8").format.borders = { preset: "all", style: "thin", color: "#CBD5E1" };
  guide.getRange("A:E").format.columnWidthPx = 170;
  guide.getRange("A10:E11").merge(true);
  guide.getRange("A10:E11").values = [
    ["Google Sheets 使用方式：打開格式檔後，請使用「檔案 > 建立副本」，再把客戶資料填入 CRM匯入 工作表。"],
    ["匯入前不要更改第一列欄位名稱；新增資料請從第 2 列開始。"],
  ];
  guide.getRange("A10:E11").format = { fill: hintFill, borders: border, wrapText: true };

  return workbook;
}

function buildQuizWorkbook() {
  const workbook = Workbook.create();
  const questions = workbook.worksheets.add("題目匯入");
  const guide = workbook.worksheets.add("使用說明");
  const lists = workbook.worksheets.add("選單資料");

  questions.showGridLines = false;
  guide.showGridLines = false;
  lists.showGridLines = false;

  const headers = [
    "專案代碼",
    "版本名稱",
    "階段名稱",
    "階段說明",
    "題目文字",
    "題型",
    "是否必填",
    "選項文字",
    "加分面向",
    "加分數值",
    "排序",
  ];
  questions.getRange("A1:K1").values = [headers];
  questions.getRange("A2:K6").values = [
    ["P01", "預設版本", "第一階段：目前狀態", "先了解目前狀況", "你目前最想解決的是什麼？", "單選", "是", "我已經想清楚，正在找適合方案", "需求清晰度", 5, 10],
    ["P01", "預設版本", "第一階段：目前狀態", "先了解目前狀況", "你目前最想解決的是什麼？", "單選", "是", "知道下一步怎麼做", "需求清晰度", 3, 20],
    ["P01", "預設版本", "第二階段：期待與補充", "確認想改善方向", "你期待諮詢後得到什麼？", "複選", "是", "釐清問題、知道下一步怎麼做", "執行準備度", 5, 30],
    ["", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", ""],
  ];
  styleHeader(questions.getRange("A1:K1"));
  questions.getRange("A1:K6").format.borders = { preset: "all", style: "thin", color: "#CBD5E1" };
  questions.getRange("A:K").format.columnWidthPx = 145;
  questions.getRange("E:E").format.columnWidthPx = 240;
  questions.getRange("H:H").format.columnWidthPx = 260;
  questions.getRange("J:K").format.numberFormat = "0";
  questions.freezePanes.freezeRows(1);
  questions.tables.add("A1:K6", true, "QuizImportTable");

  lists.getRange("A1:C1").values = [["題型", "是否必填", "常見面向"]];
  lists.getRange("A2:C7").values = [
    ["單選", "是", "需求清晰度"],
    ["複選", "否", "預約急迫度"],
    ["簡答", "", "執行準備度"],
    ["長答", "", ""],
    ["", "", ""],
    ["", "", ""],
  ];
  styleHeader(lists.getRange("A1:C1"));
  lists.getRange("A:C").format.columnWidthPx = 145;
  questions.getRange("F2:F200").dataValidation = { rule: { type: "list", formula1: "選單資料!$A$2:$A$5" } };
  questions.getRange("G2:G200").dataValidation = { rule: { type: "list", formula1: "選單資料!$B$2:$B$3" } };
  questions.getRange("J2:K200").dataValidation = { rule: { type: "whole", operator: "between", formula1: 0, formula2: 100 } };

  guide.getRange("A1:E1").merge();
  guide.getRange("A1").values = [["測驗題目匯入格式檔"]];
  guide.getRange("A1").format = { fill: headerFill, font: { bold: true, color: "#FFFFFF", size: 14 } };
  guide.getRange("A3:E10").values = [
    ["欄位", "是否必填", "填寫方式", "範例", "說明"],
    ["專案代碼", "必填", "文字", "P01", "對應後台專案，通常由工程師或管理者提供。"],
    ["版本名稱", "必填", "文字", "預設版本", "同一專案可做不同版本或 A/B test。"],
    ["階段名稱", "必填", "文字", "第一階段：目前狀態", "同一階段名稱會自動歸在同一題目階段。"],
    ["題目文字", "必填", "文字", "你目前最想解決的是什麼？", "相同題目可有多列選項。"],
    ["題型 / 是否必填", "必填", "下拉選單", "單選 / 是", "題型請用選單，不要自行輸入未知代碼。"],
    ["選項文字", "依題型", "文字", "知道下一步怎麼做", "簡答/長答可以留空。"],
    ["加分面向 / 加分數值", "選填", "文字 + 整數", "需求清晰度 / 5", "需要計分的選項才填；分數請填整數。"],
  ];
  styleHeader(guide.getRange("A3:E3"));
  guide.getRange("A3:E10").format.borders = { preset: "all", style: "thin", color: "#CBD5E1" };
  guide.getRange("A:E").format.columnWidthPx = 180;
  guide.getRange("A12:E14").merge(true);
  guide.getRange("A12:E14").values = [
    ["Google Sheets 使用方式：打開格式檔後，請使用「檔案 > 建立副本」，再把題目填入 題目匯入 工作表。"],
    ["每個選項一列；同一題的題目文字保持一致，系統匯入時會合併成同一題。"],
    ["面向代碼不用給客戶填，系統會依面向名稱在背後建立或對應。"],
  ];
  guide.getRange("A12:E14").format = { fill: warningFill, borders: border, wrapText: true };

  return workbook;
}

await saveWorkbook(buildCrmWorkbook(), "crm-import-template", "使用說明");
await saveWorkbook(buildQuizWorkbook(), "quiz-import-template", "使用說明");
