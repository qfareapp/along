// Original Along vector illustrations. Rebuild the bundled native PNGs with:
// node tools/category-covers.mjs
import fs from "node:fs/promises";
import { createRequire } from "node:module";
const sharp = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
)("sharp");
const motifs = {
  coffee: `<ellipse cx="210" cy="245" rx="118" ry="17" fill="#dba47c"/><path d="M127 129h151l-15 95q-58 38-118 0z" fill="#fff8f2"/><path d="M277 148h21q40 35-26 48" fill="none" stroke="#fff8f2" stroke-width="18"/><ellipse cx="202" cy="130" rx="75" ry="15" fill="#734e3c"/><path d="M178 101q-20-20 0-43m45 43q-20-20 0-43" stroke="#fff8f2" stroke-width="8" fill="none"/>`,
  commute: `<path d="M0 255Q190 165 400 258" fill="#c3d4c1"/><rect x="96" y="94" width="214" height="134" rx="27" fill="#174f54"/><rect x="113" y="109" width="180" height="65" rx="13" fill="#e1eee5"/><path d="M204 111v61M98 194h211" stroke="#f4c9a8" stroke-width="6"/><circle cx="142" cy="227" r="22" fill="#27343b"/><circle cx="267" cy="227" r="22" fill="#27343b"/><circle cx="125" cy="194" r="9" fill="#f4c9a8"/>`,
  travel: `<circle cx="290" cy="83" r="36" fill="#f47768"/><path d="M-20 266 112 76l114 190" fill="#739b87"/><path d="m70 137 42-61 38 61-39-16z" fill="#fff8f2"/><path d="m163 270 112-139 140 139" fill="#174f54"/><path d="M0 267q100-70 200 0t210-10v70H0" fill="#f4c9a8"/>`,
  food: `<ellipse cx="205" cy="229" rx="120" ry="33" fill="#bd8e69"/><path d="M94 160h218q-8 89-109 89t-109-89" fill="#fff8f2"/><ellipse cx="203" cy="158" rx="109" ry="26" fill="#174f54"/><path d="m143 157 32-49 28 55 40-65 28 60" fill="none" stroke="#e5b950" stroke-width="15"/><path d="m247 119 36-70m-13 79 40-70" stroke="#744c38" stroke-width="7"/>`,
  shopping: `<path d="m89 136 138-9 20 124H79z" fill="#f47768"/><path d="M119 139v-27q33-65 75-6v30" fill="none" stroke="#fff8f2" stroke-width="8"/><path d="m230 162 94-10 13 99H218z" fill="#174f54"/><path d="M245 163v-28q31-39 61-2v23" fill="none" stroke="#f4c9a8" stroke-width="7"/>`,
  fitness: `<path d="M69 224q66-16 94-84l67 42q8 22 72 32 30 5 33 31H67z" fill="#f47768"/><path d="M68 244h267v14H68z" fill="#fff8f2"/><path d="m174 164 41 19m-54-3 42 18m-53-1 37 17" stroke="#fff8f2" stroke-width="7"/><path d="M256 111h54m-43-21v42m30-42v42" stroke="#174f54" stroke-width="14"/>`,
  movies: `<rect x="90" y="95" width="225" height="144" rx="18" fill="#174f54"/><path d="M90 96h225v36H90z" fill="#27343b"/><path d="m111 96 25 36m35-36 25 36m35-36 25 36m35-36 24 36" stroke="#fff8f2" stroke-width="13"/><path d="m183 157 47 27-47 28z" fill="#f47768"/><circle cx="309" cy="77" r="19" fill="#e4b75f"/>`,
  hobbies: `<path d="M106 218q-58-77 16-120 89-60 165 11 68 72-17 106-34 14-57-16t-52 14q-29 31-55 5" fill="#fff8f2"/><circle cx="142" cy="128" r="16" fill="#f47768"/><circle cx="193" cy="106" r="15" fill="#e4b75f"/><circle cx="247" cy="134" r="17" fill="#739b87"/><path d="m233 211 61-130" stroke="#174f54" stroke-width="12"/><path d="m233 208-15 40 35-30" fill="#174f54"/>`,
  sports: `<circle cx="203" cy="165" r="89" fill="#f47768"/><path d="M115 165h176M203 77v176M141 101q89 62 0 127m125-127q-89 62 0 127" stroke="#fff8f2" stroke-width="6" fill="none"/>`,
  learning: `<path d="M203 116q-56-36-113-13v126q56-23 113 13 56-36 113-13V103q-57-23-113 13" fill="#fff8f2"/><path d="M203 116v126m-95-114q35-9 71 10m-71 17q35-9 71 10m44-27q35-19 71-10m-71 37q35-19 71-10" fill="none" stroke="#739b87" stroke-width="5"/><path d="m252 82 41-35 12 20-45 28" fill="#f47768"/>`,
  events: `<path d="M70 99h263v143H70z" fill="#174f54"/><path d="M70 99h65q-4 90-65 121m263-121h-65q4 90 65 121" fill="#f47768"/><path d="M109 243h185l25 17H84z" fill="#27343b"/><path d="m203 115 10 26 29 2-23 18 7 28-23-15-24 15 7-28-23-18 29-2z" fill="#e4b75f"/>`,
  culture: `<path d="M55 72q135 45 290 0" fill="none" stroke="#174f54" stroke-width="5"/><path d="M121 89v33m153-33v53" stroke="#174f54" stroke-width="4"/><ellipse cx="121" cy="170" rx="45" ry="51" fill="#f47768"/><ellipse cx="274" cy="190" rx="39" ry="48" fill="#e4b75f"/><path d="M121 121v99m-23-93q-20 47 0 86m45-86q20 47 0 86m131-70v95" fill="none" stroke="#fff8f2" stroke-width="4"/><path d="M121 220v29m153-12v24" stroke="#174f54" stroke-width="5"/>`,
  volunteering: `<path d="M201 212v-91" stroke="#174f54" stroke-width="9"/><path d="M200 171q-91 5-72-71 67-1 72 71m5-17q0-74 71-71 7 73-71 71" fill="#739b87"/><path d="M78 209q35-23 85 12h79q22 1 15 18l-55 7 85-17q25-7 24 10l-100 39-75-18-58-5z" fill="#f47768"/>`,
};
await fs.mkdir("apps/mobile/assets/categories", { recursive: true });
for (const [key, motif] of Object.entries(motifs)) {
  const background = [
    "commute",
    "fitness",
    "learning",
    "volunteering",
  ].includes(key)
    ? "#e2eade"
    : ["movies", "events", "culture"].includes(key)
      ? "#eadbd2"
      : "#f4d9c2";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="${background}"/><circle cx="343" cy="30" r="105" fill="#fff8f2" opacity=".3"/><circle cx="23" cy="282" r="74" fill="#fff8f2" opacity=".2"/>${motif}</svg>`;
  await fs.writeFile(`apps/mobile/assets/categories/${key}.svg`, svg);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(`apps/mobile/assets/categories/${key}.png`);
}
