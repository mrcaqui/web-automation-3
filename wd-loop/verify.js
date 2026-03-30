async page => {
  const evs = page.locator('[data-automation-id="calendarevent"]');
  const cnt = await evs.count();
  let hwCount = 0, ocCount = 0;
  for (let i = 0; i < cnt; i++) {
    const lb = await evs.nth(i).getAttribute('aria-label').catch(() => '');
    if (!lb || !lb.includes('\u672a\u9001\u4fe1')) continue;
    if (lb.includes('12:00 - 13:00')) continue;
    if (lb.includes('Hours Worked')) hwCount++;
    else if (lb.includes('On Call Standby Hours')) ocCount++;
  }
  return JSON.stringify({ hwCount, ocCount, total: hwCount + ocCount });
}
