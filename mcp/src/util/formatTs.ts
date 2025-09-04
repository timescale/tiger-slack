/**
 * Format the `ts` input field as expected by the db. Users may pass in the formats used by Slack, like
 * `p1751615372800899` or `1751615372.800899`, but we need to format it as a PostgreSQL timestamp
 *  like `2025-07-04 07:49:32.800899+00`
 */
export const convertTsToTimestamp = (ts: string): string => {
  if (/^p\d+$/.test(ts)) {
    return new Date(parseInt(ts.slice(1, -3), 10))
      .toISOString()
      .replace('T', ' ')
      .replace('Z', `${ts.slice(-3)}+00`);
  } else if (/^\d+\.\d+$/.test(ts)) {
    const [seconds, fraction] = ts.split('.');
    return new Date(
      parseInt(seconds, 10) * 1000 + parseInt(fraction, 10) / 1000,
    )
      .toISOString()
      .replace('T', ' ')
      .replace('Z', `${fraction.slice(3).padEnd(3, '0')}+00`);
  }
  return ts;
};

/**
 * Convert PostgreSQL timestamp format back to Slack's `ts` format. Takes a timestamp
 * like `2025-07-04 07:49:32.800899+00` and converts it to Slack's format like `1751615372.800899`
 */
export const convertTimestampToTs = (
  timestamp: string,
  asMicroseconds = false,
): string | null => {
  const match = timestamp.match(
    /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.?(\d{0,6})\+00$/,
  );
  if (!match) {
    console.warn(`Could not parse timestamp ${timestamp}`);
    return null;
  }
  const [, dateTime, fraction] = match;
  const date = new Date(dateTime.replace(' ', 'T') + 'Z');
  const seconds = Math.floor(date.getTime() / 1000);
  return `${seconds}${asMicroseconds ? '' : '.'}${fraction.padEnd(6, '0')}`;
};
