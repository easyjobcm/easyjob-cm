import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPhone(phone: string): string {
  // Format Cameroon phone numbers: +237 6XX XXX XXX
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("237")) {
    const number = cleaned.slice(3);
    return `+237 ${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`;
  }
  return phone;
}

export function validateCameroonPhone(phone: string): boolean {
  // Cameroon phone: must start with 6 or 2 and be 9 digits
  const cleaned = phone.replace(/\D/g, "");
  const withoutCountryCode = cleaned.startsWith("237")
    ? cleaned.slice(3)
    : cleaned;
  return /^[62]\d{8}$/.test(withoutCountryCode);
}

export function formatCurrency(
  amount: number,
  currency: string = "XAF",
): string {
  return new Intl.NumberFormat("fr-CM", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: Date | string, locale: string = "fr"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/** Affiché quand l'heure est absente ou illisible (jamais une heure inventée). */
export const TIME_PLACEHOLDER = "--:--";

const SQL_TIME = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/**
 * Heure d'affichage. Accepte une colonne SQL `time` (« 09:00:00 », « 09:00 »)
 * ou un instant (Date, horodatage ISO). Une heure SQL est une heure murale
 * sans date ni fuseau : elle est formatée telle quelle (le calcul en UTC ne
 * sert qu'à éviter tout décalage), alors qu'un instant suit le fuseau local.
 */
export function formatTime(
  value: Date | string | null | undefined,
  locale: string = "fr",
): string {
  const format = (d: Date, timeZone?: string) =>
    new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(d);

  if (value == null || value === "") return TIME_PLACEHOLDER;
  if (typeof value === "string") {
    const sql = SQL_TIME.exec(value.trim());
    if (sql) {
      const [hours, minutes] = [Number(sql[1]), Number(sql[2])];
      if (hours > 23 || minutes > 59) return TIME_PLACEHOLDER;
      return format(new Date(Date.UTC(1970, 0, 1, hours, minutes)), "UTC");
    }
  }
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? TIME_PLACEHOLDER : format(d);
}

export function formatRelativeTime(
  date: Date | string,
  locale: string = "fr",
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - d.getTime()) / 1000);

  const rtf = new Intl.RelativeTimeFormat(locale === "fr" ? "fr" : "en", {
    numeric: "auto",
  });

  if (diffInSeconds < 60) return rtf.format(-diffInSeconds, "second");
  if (diffInSeconds < 3600)
    return rtf.format(-Math.floor(diffInSeconds / 60), "minute");
  if (diffInSeconds < 86400)
    return rtf.format(-Math.floor(diffInSeconds / 3600), "hour");
  if (diffInSeconds < 2592000)
    return rtf.format(-Math.floor(diffInSeconds / 86400), "day");
  if (diffInSeconds < 31536000)
    return rtf.format(-Math.floor(diffInSeconds / 2592000), "month");
  return rtf.format(-Math.floor(diffInSeconds / 31536000), "year");
}

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + "...";
}

export function calculateAge(birthDate: Date | string): number {
  const today = new Date();
  const birth = typeof birthDate === "string" ? new Date(birthDate) : birthDate;
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
