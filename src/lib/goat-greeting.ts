/** Office-local greeting and the date line used on the GOAT Page and in the chat popup. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** May, June, and July have no period. Every other month does. */
export const GOAT_MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."] as const;

/** Before noon, from noon until 5, and from 5 onward. Uses the clock's local hour. */
export function goatGreeting(hour: number): string {
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

export function goatWelcomeEmoji(hour: number): string {
  if (hour < 12) return "☀️";
  if (hour < 17) return "🌤️";
  return "🌙";
}

/** "Good Morning! ☀️ Happy Wednesday, Nov. 11, 2026" */
export function goatWelcomeLine(date: Date): string {
  return `${goatGreeting(date.getHours())}! ${goatWelcomeEmoji(date.getHours())} Happy ${goatGreetingDate(date)}`;
}

/** "Wednesday, Nov. 11, 2026" and "Friday, June 5, 2026". */
export function goatGreetingDate(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${GOAT_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
