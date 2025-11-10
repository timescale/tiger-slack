export const DEFAULT_NUMBER_OF_DAYS_TO_INCLUDE = 7;

export const getDate = (numberOfDaysAgo: number, currentDate?: Date): Date =>
  new Date(
    (currentDate ? currentDate.getTime() : Date.now()) -
      numberOfDaysAgo * 24 * 60 * 60 * 1000,
  );

export const getStartAndEndTimes = ({
  rangeEnd,
  rangeStart,
}: {
  rangeEnd: Date | null;
  rangeStart: Date | null;
}): { endTs: Date; startTs: Date } => {
  const endTs = rangeEnd || new Date();
  const startTs =
    rangeStart || getDate(DEFAULT_NUMBER_OF_DAYS_TO_INCLUDE, endTs);

  if (endTs <= startTs) {
    throw new Error(
      'The range start date needs to be after the range start date',
    );
  }
  return { endTs, startTs };
};
