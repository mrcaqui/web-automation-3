async page => {
  let del = 0;
  for (let r = 0; r < 200; r++) {
    const evs = page.locator('[data-automation-id="calendarevent"]');
    const cnt = await evs.count();
    let hit = false;
    for (let i = 0; i < cnt; i++) {
      const lb = await evs.nth(i).getAttribute('aria-label').catch(() => '');
      if (lb && lb.includes('\u672a\u9001\u4fe1') &&
          (lb.includes('Hours Worked') || lb.includes('On Call Standby Hours'))) {
        await evs.nth(i).click();
        const ed = page.getByRole('textbox', { name: '\u958b\u59cb' });
        if (await ed.isVisible({ timeout: 5000 }).catch(() => false)) {
          await page.getByRole('button', { name: '\u524a\u9664' }).click();
          await page.getByRole('button', { name: 'OK' }).click();
          await ed.waitFor({ state: 'hidden', timeout: 5000 });
          await page.waitForTimeout(300);
          del++;
        } else {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
          const cb = page.getByRole('button', { name: '\u9589\u3058\u308b' });
          if (await cb.isVisible({ timeout: 1000 }).catch(() => false)) await cb.click();
          await page.waitForTimeout(300);
        }
        hit = true;
        break;
      }
    }
    if (!hit) break;
  }
  return JSON.stringify({ deleted: del });
}
