const HC_TIME_ZONE = 'Asia/Shanghai';

function getHcBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: HC_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  );
  return { year: values.year, month: values.month, day: values.day };
}

module.exports = { HC_TIME_ZONE, getHcBusinessDate };
