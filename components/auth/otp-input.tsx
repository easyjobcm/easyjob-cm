"use client";

import * as React from "react";

interface OtpInputProps {
  value: string;
  onChange: (token: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}

export function OtpInput({
  value,
  onChange,
  length = 6,
  autoFocus,
  disabled,
  invalid,
}: OtpInputProps) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const digits = React.useMemo(() => {
    const arr = value.split("").slice(0, length);
    while (arr.length < length) arr.push("");
    return arr;
  }, [value, length]);

  const setAt = (index: number, char: string) => {
    const next = [...digits];
    next[index] = char;
    onChange(next.join(""));
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    index: number,
  ) => {
    const c = e.target.value.replace(/\D/g, "");
    if (!c) {
      setAt(index, "");
      return;
    }
    if (c.length > 1) {
      // Paste-like: spread across remaining slots
      const arr = [...digits];
      for (let i = 0; i < c.length && index + i < length; i++) {
        arr[index + i] = c[i];
      }
      onChange(arr.join(""));
      const focusIndex = Math.min(index + c.length, length - 1);
      refs.current[focusIndex]?.focus();
      return;
    }
    setAt(index, c);
    if (index < length - 1) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
  ) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  return (
    <div className="flex justify-center gap-2" role="group" aria-label="OTP">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={length}
          autoFocus={autoFocus && i === 0}
          disabled={disabled}
          value={d}
          onChange={(e) => handleChange(e, i)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          aria-invalid={invalid}
          className={
            "h-14 w-12 rounded-xl border-2 bg-white dark:bg-white/5 text-center text-2xl font-bold text-gray-900 dark:text-white transition-colors outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20 disabled:opacity-60 " +
            (invalid
              ? "border-red-400"
              : d
                ? "border-[#7C3AED] bg-[#F3E8FF] dark:bg-[#7C3AED]/20"
                : "border-[#E5E7EB] dark:border-white/10")
          }
        />
      ))}
    </div>
  );
}
