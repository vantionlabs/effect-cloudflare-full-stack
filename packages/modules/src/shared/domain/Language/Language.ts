/**
 * Which language a question is written in — decided in code, so the prompt can STATE it.
 *
 * Every prompt already said "answer in the language of the question", and the model still answered Dutch questions
 * in English: an instruction that asks the model to work something out is one it can get wrong, and the system
 * prompt around it is all English. Naming the language ("The question is in Dutch") leaves nothing to infer.
 *
 * Deliberately small: a count of words that are common in one language and rare in the other. Words both languages
 * share (`is`, `in`, `week`, `we`) are left out because they carry no signal. When neither side wins, the answer is
 * `undefined` and the prompt says nothing — the old instruction still applies, which is no worse than before.
 */

export type Language = "Dutch" | "English"

const DUTCH = new Set([
  "de",
  "het",
  "een",
  "en",
  "van",
  "wat",
  "hoeveel",
  "hoe",
  "welke",
  "wanneer",
  "waarom",
  "wie",
  "ik",
  "wij",
  "onze",
  "ons",
  "deze",
  "dit",
  "die",
  "voor",
  "met",
  "niet",
  "zijn",
  "maand",
  "geld",
  "komt",
  "binnen",
  "er",
  "op",
  "aan",
  "te",
  "kan",
  "moet",
  "volgende",
  "vorige",
  "deze",
  "hebben",
  "heb",
  "hebt",
  "zijn",
  "waren",
  "worden",
  "nog",
  "ook",
  "welk",
  "verstuurd",
  "offertes",
  "offerte",
  "facturen",
  "factuur",
  "klant",
  "klanten",
  "uit",
  "naar",
  "bij",
  "mijn",
  "jij",
  "je",
  "u",
  "uw",
  "over",
  "tot",
  "dan",
  "wordt",
  "veel",
  "hoelang",
  "waar"
])

const ENGLISH = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "what",
  "how",
  "many",
  "much",
  "which",
  "when",
  "why",
  "who",
  "are",
  "our",
  "this",
  "these",
  "for",
  "with",
  "not",
  "month",
  "money",
  "sent",
  "quotes",
  "quote",
  "invoices",
  "invoice",
  "customer",
  "customers",
  "did",
  "do",
  "does",
  "was",
  "were",
  "have",
  "has",
  "will",
  "next",
  "last",
  "to",
  "from",
  "my",
  "you",
  "your",
  "about",
  "until",
  "than",
  "where",
  "can",
  "should",
  "there",
  "out",
  "at"
])

export const detectLanguage = (text: string): Language | undefined => {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  let dutch = 0
  let english = 0
  for (const word of words) {
    if (DUTCH.has(word)) dutch++
    if (ENGLISH.has(word)) english++
  }
  if (dutch > english) return "Dutch"
  if (english > dutch) return "English"
  return undefined
}

/**
 * A line for the end of a system prompt naming the answer's language, or an empty string when it cannot be told.
 * "The whole answer" on purpose: a model told to answer in Dutch would still write a refusal or a hedge in English.
 */
export const answerLanguageRule = (question: string): string => {
  const language = detectLanguage(question)
  return language === undefined
    ? ""
    : `\n- The question is written in ${language}. Write your WHOLE answer in ${language}, including any statement ` +
      `that something is unknown or not available.`
}
