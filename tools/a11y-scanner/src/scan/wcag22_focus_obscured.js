'use strict';

async function checkFocusNotObscured(page) {
  const result = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const steps = 5;
    let obscured = 0;
    let total = 0;
    for (let x = 0; x < steps; x++) {
      for (let y = 0; y < steps; y++) {
        const px = rect.left + (x + 0.5) * (rect.width / steps);
        const py = rect.top + (y + 0.5) * (rect.height / steps);
        if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) continue;
        total++;
        const topEl = document.elementFromPoint(px, py);
        if (topEl && topEl !== el && !el.contains(topEl)) {
          obscured++;
        }
      }
    }
    const ratio = total > 0 ? obscured / total : 0;
    return { ratio };
  });
  return result;
}

module.exports = { checkFocusNotObscured };
