async page => {
  const dates = [
    '3\u67081\u65e5','3\u67082\u65e5','3\u67083\u65e5','3\u67084\u65e5','3\u67085\u65e5',
    '3\u67086\u65e5','3\u67087\u65e5','3\u67088\u65e5','3\u67089\u65e5','3\u670810\u65e5',
    '3\u670811\u65e5','3\u670812\u65e5','3\u670813\u65e5','3\u670814\u65e5','3\u670815\u65e5',
    '3\u670816\u65e5','3\u670817\u65e5','3\u670818\u65e5','3\u670819\u65e5','3\u670820\u65e5',
    '3\u670821\u65e5','3\u670822\u65e5','3\u670823\u65e5','3\u670824\u65e5','3\u670825\u65e5',
    '3\u670826\u65e5','3\u670827\u65e5'
  ];
  const types = ['Hours Worked', 'On Call Standby Hours'];
  let del = 0;
  for (const tt of types) {
    for (const d of dates) {
      for (let retry = 0; retry < 10; retry++) {
        await page.waitForTimeout(800);
        const sel = '[data-automation-id="calendarevent"][aria-label*="\u672a\u9001\u4fe1"][aria-label*="' + tt + '"][aria-label*="' + d + '"]';
        const evCount = await page.locator(sel).count();
        if (evCount === 0) break;
        const ev = page.locator(sel).first();
        try {
          await ev.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
          await page.waitForTimeout(1000);
          await ev.click({ force: true, timeout: 3000 });
        } catch (e) {
          await page.waitForTimeout(1000);
          continue;
        }
        await page.waitForTimeout(1500);
        const delBtn = page.getByRole('button', { name: '\u524a\u9664' });
        if (await delBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await delBtn.click();
          const okBtn = page.getByRole('button', { name: 'OK' });
          if (await okBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await okBtn.click();
            await page.waitForTimeout(3500);
          }
          del++;
        } else {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        }
      }
    }
  }
  return JSON.stringify({ deleted: del });
}
