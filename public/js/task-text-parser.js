// 自由入力された文章を、画面やDB処理から独立して解析するモジュール
(function initializeTaskTextParser(global) {
  "use strict";

  const VALID_PRIORITIES = new Set(["高", "中", "低"]);
  const WEEKDAY_INDEX = {
    月: 0,
    火: 1,
    水: 2,
    木: 3,
    金: 4,
    土: 5,
    日: 6,
  };

  const HIGH_PRIORITY_PHRASES = [
    "できるだけ早く",
    "最優先",
    "早急に",
    "早急",
    "至急",
    "急ぎ",
    "緊急",
  ];
  const LOW_PRIORITY_PHRASES = [
    "後回しでもよい",
    "後回しでよい",
    "時間があるときに",
    "時間がある時に",
    "急がない",
    "急ぎではない",
    "優先度は低",
  ];

  function startOfDay(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function addDays(value, days) {
    const date = startOfDay(value);
    date.setDate(date.getDate() + days);
    return date;
  }

  function formatDateValue(value) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function createStrictDate(year, month, day) {
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function getMondayOfWeek(value) {
    const date = startOfDay(value);
    const daysFromMonday = (date.getDay() + 6) % 7;
    return addDays(date, -daysFromMonday);
  }

  // 自然な日付表現を日付値と、タイトルから除去する文字列に分けて返す
  function extractDueDate(text, baseDate) {
    const normalizedBaseDate = startOfDay(baseDate);
    let match = text.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?/);
    if (match) {
      const date = createStrictDate(
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
      );
      return {
        value: date ? formatDateValue(date) : null,
        matchedText: match[0],
      };
    }

    match = text.match(/(\d{1,2})月(\d{1,2})日/);
    if (match) {
      let year = normalizedBaseDate.getFullYear();
      let date = createStrictDate(year, Number(match[1]), Number(match[2]));
      if (date && date < normalizedBaseDate) {
        year += 1;
        date = createStrictDate(year, Number(match[1]), Number(match[2]));
      }
      return {
        value: date ? formatDateValue(date) : null,
        matchedText: match[0],
      };
    }

    const relativeDays = [
      { pattern: /明後日/, days: 2 },
      { pattern: /明日/, days: 1 },
      { pattern: /今日/, days: 0 },
    ];
    for (const rule of relativeDays) {
      match = text.match(rule.pattern);
      if (match) {
        return {
          value: formatDateValue(addDays(normalizedBaseDate, rule.days)),
          matchedText: match[0],
        };
      }
    }

    match = text.match(/(今週|来週)(?:の)?末/);
    if (match) {
      const monday = getMondayOfWeek(normalizedBaseDate);
      const weekOffset = match[1] === "来週" ? 7 : 0;
      return {
        value: formatDateValue(addDays(monday, weekOffset + 6)),
        matchedText: match[0],
      };
    }

    match = text.match(/(今週|来週)(?:の)?([月火水木金土日])曜日?/);
    if (match) {
      const monday = getMondayOfWeek(normalizedBaseDate);
      const weekOffset = match[1] === "来週" ? 7 : 0;
      return {
        value: formatDateValue(
          addDays(monday, weekOffset + WEEKDAY_INDEX[match[2]]),
        ),
        matchedText: match[0],
      };
    }

    match = text.match(/次の([月火水木金土日])曜日?/);
    if (match) {
      const targetDay = WEEKDAY_INDEX[match[1]];
      const currentDay = (normalizedBaseDate.getDay() + 6) % 7;
      let daysToAdd = (targetDay - currentDay + 7) % 7;
      if (daysToAdd === 0) daysToAdd = 7;
      return {
        value: formatDateValue(addDays(normalizedBaseDate, daysToAdd)),
        matchedText: match[0],
      };
    }

    return { value: null, matchedText: "" };
  }

  // 否定的な表現を先に評価し、「急がない」を高重要度と誤認しないようにする
  function extractPriority(text) {
    if (LOW_PRIORITY_PHRASES.some((phrase) => text.includes(phrase))) {
      return "低";
    }
    if (HIGH_PRIORITY_PHRASES.some((phrase) => text.includes(phrase))) {
      return "高";
    }
    return "中";
  }

  function cleanCategoryName(value) {
    if (typeof value !== "string") return null;
    const cleaned = value
      .replace(/^(?:このタスク|この予定|これは|タスク)(?:は|を)?/, "")
      .replace(/^[「『"']|[」』"']$/g, "")
      .trim();
    return cleaned && cleaned.length <= 50 ? cleaned : null;
  }

  // 分類を指示する代表的な言い回しから分類名だけを取り出す
  function extractCategoryName(text) {
    const patterns = [
      /(?:^|[。！？\n、,])(?:このタスクは|この予定は|これは)?\s*([^。！？、,\n]{1,40}?)の(?:分類|カテゴリ|カテゴリー)(?=に|へ|として|。|$)/,
      /(?:^|[。！？\n、,])(?:このタスクは|この予定は|これは)?\s*([^。！？、,\n]{1,40}?)に分類/,
      /(?:^|[。！？\n、,])(?:このタスクは|この予定は|これは)?\s*([^。！？、,\n]{1,40}?)として登録/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const categoryName = cleanCategoryName(match[1]);
        if (categoryName) return categoryName;
      }
    }
    return null;
  }

  function isCategoryDirective(text) {
    return (
      /(?:分類|カテゴリ|カテゴリー)(?:に|へ|として|$)/.test(text) ||
      /に分類|として登録/.test(text)
    );
  }

  // 指示語を取り除き、実際に行う内容をタスク名として残す
  function extractTitle(text, dateMatch) {
    const segments = text
      .split(/[。！？\n]+/)
      .flatMap((segment) => segment.split(/[、,]/))
      .map((segment) => segment.trim())
      .filter((segment) => segment && !isCategoryDirective(segment));

    let title = segments.join("。");
    if (dateMatch.matchedText) {
      title = title.replace(dateMatch.matchedText, "");
    }

    [...LOW_PRIORITY_PHRASES, ...HIGH_PRIORITY_PHRASES].forEach((phrase) => {
      title = title.replaceAll(phrase, "");
    });

    title = title
      .replace(/^(?:までに|まで|に|は|を)+/, "")
      .replace(/を[にで](?=\S)/g, "を")
      .replace(/(?:までに|まで)(?=\S)/g, "")
      .replace(/作ってください/g, "作る")
      .replace(/(?:してください|して下さい)/g, "")
      .replace(/[。！？、,\s]+$/g, "")
      .replace(/^[。！？、,\s]+/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    return title || text.trim();
  }

  function isValidDateValue(value) {
    if (typeof value !== "string") return false;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    return Boolean(
      createStrictDate(Number(match[1]), Number(match[2]), Number(match[3])),
    );
  }

  // 想定した4項目だけを採用し、不正値や未知の項目は画面へ渡さない
  function validateParsedTask(candidate, fallbackTitle = "") {
    const title =
      typeof candidate?.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : String(fallbackTitle || "").trim();
    const dueDate = isValidDateValue(candidate?.dueDate)
      ? candidate.dueDate
      : null;
    const priority = VALID_PRIORITIES.has(candidate?.priority)
      ? candidate.priority
      : "中";
    const categoryName =
      typeof candidate?.categoryName === "string"
        ? cleanCategoryName(candidate.categoryName)
        : null;

    return {
      title,
      dueDate,
      priority,
      categoryName,
    };
  }

  function parseTaskText(text, options = {}) {
    const sourceText = typeof text === "string" ? text.trim() : "";
    const baseDate = options.baseDate instanceof Date ? options.baseDate : new Date();
    const dateMatch = extractDueDate(sourceText, baseDate);

    const candidate = {
      title: extractTitle(sourceText, dateMatch),
      dueDate: dateMatch.value,
      priority: extractPriority(sourceText),
      categoryName: extractCategoryName(sourceText),
    };

    return validateParsedTask(candidate, sourceText);
  }

  global.TaskTextParser = Object.freeze({
    parse: parseTaskText,
    validate: validateParsedTask,
  });
})(window);
