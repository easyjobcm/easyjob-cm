"use client";

import * as React from "react";

interface PhoneInputProps {
  value: string;
  onChange: (raw: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
}

/** Téléphone CM : 9 chiffres après +237. Format affichage : 6XX XXX XXX */
export function PhoneInput({
  value,
  onChange,
  autoFocus,
  disabled,
  id = "phone",
  invalid,
}: PhoneInputProps) {
  const format = (raw: string) => {
    const c = raw.replace(/\D/g, "").slice(0, 9);
    if (c.length <= 3) return c;
    if (c.length <= 6) return `${c.slice(0, 3)} ${c.slice(3)}`;
    return `${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6, 9)}`;
  };

  return (
    <div className="flex gap-2">
      <div className="flex h-12 shrink-0 items-center justify-center rounded-xl bg-[#F3E8FF] dark:bg-[#7C3AED]/20 px-4 text-sm font-semibold text-[#5B21B6] dark:text-[#A78BFA]">
        +237
      </div>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="6XX XXX XXX"
        value={format(value)}
        onChange={(e) =>
          onChange(e.target.value.replace(/\D/g, "").slice(0, 9))
        }
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={invalid}
        className={
          "h-12 flex-1 rounded-xl border bg-white dark:bg-white/5 px-4 text-base font-medium tracking-wide text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 outline-none transition-colors focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20 disabled:bg-gray-50 dark:disabled:bg-white/[0.02] " +
          (invalid ? "border-red-400" : "border-[#E5E7EB] dark:border-white/10")
        }
      />
    </div>
  );
}
