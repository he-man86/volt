/**
 * The STRING conversions' formatters — `iec_*_text`, line for line the interpreter's (`semantics/text.ts`); the differential
 * test and the twin harness check both against CODESYS. Mind the escapes: a backslash or a backtick here is the template
 * literal's.
 */
export const TEXT = `// LREAL_TO_STRING - fifteen significant digits, trailing zeros stripped but never the last decimal, FIXED while
// the decimal exponent is 0..13 and exponential otherwise, lowercase e with no sign and no padding. Mirrors
// lrealText in the interpreter; 26 cells measured, and REAL_TO_STRING is a DIFFERENT formatter that is still
// refused by lowering (see the note there).
fn iec_lreal_text(v: f64) -> String {
    if v.is_nan() { return String::from("#NaN"); }
    if v.is_infinite() { return String::from(if v < 0.0 { "-#Inf" } else { "#Inf" }); }
    if v == 0.0 { return String::from("0.0"); }
    let sign = if v < 0.0 { "-" } else { "" };
    // Round to fifteen significant digits FIRST, so the exponent deciding the notation is the printed one — and HALF-UP
    // on the exact value, as CODESYS and toExponential do (tr_33_fmt_lreal_tie). format!'s own rounding is half-to-even,
    // and rounding to any shorter precision first can carry into the 16th digit, so this takes the EXACT expansion
    // (an f64 has at most 767 significant digits) and decides on its 16th digit alone.
    let text = format!("{:.*e}", 800, v.abs());
    let (mantissa, exponent) = text.split_once('e').unwrap();
    let exact: Vec<u8> = mantissa.bytes().filter(|c| *c != b'.').collect();
    let mut exponent: i32 = exponent.parse().unwrap();
    let mut kept = exact[..15].to_vec();
    if exact[15] >= b'5' {
        let mut i = 15;
        while i > 0 && kept[i - 1] == b'9' { kept[i - 1] = b'0'; i -= 1; }
        if i == 0 { kept[0] = b'1'; exponent += 1; } else { kept[i - 1] += 1; }
    }
    let digits = String::from_utf8(kept).unwrap();
    let trim = |whole: &str, fraction: &str| -> String {
        let kept = fraction.trim_end_matches('0');
        format!("{}.{}", whole, if kept.is_empty() { "0" } else { kept })
    };
    if !(0..=13).contains(&exponent) {
        return format!("{}{}e{}", sign, trim(&digits[..1], &digits[1..]), exponent);
    }
    let point = (exponent + 1) as usize;
    let mut whole = digits[..point.min(digits.len())].to_string();
    while whole.len() < point { whole.push('0'); }
    format!("{}{}", sign, trim(&whole, if point < digits.len() { &digits[point..] } else { "" }))
}
// TIME → STRING: T# and each non-zero component, largest first — 'T#1d2h', 'T#1s500ms', and 'T#0ms' for zero.
fn iec_time_text(ms: i64) -> String { let mut rest = ms; let mut out = String::new(); for (unit, suffix) in [(86_400_000i64, "d"), (3_600_000, "h"), (60_000, "m"), (1000, "s"), (1, "ms")] { let n = rest / unit; rest %= unit; if n != 0 { out.push_str(&format!("{}{}", n, suffix)); } } if out.is_empty() { out.push_str("0ms"); } format!("T#{}", out) }
// LTIME as text: a TIME's shape with the LTIME# prefix and three units below a millisecond, and the zero case names
// the SMALLEST unit. Mirrors ltimeText in the interpreter; every component boundary measured.
fn iec_ltime_text(ns: u64) -> String { let mut rest = ns; let mut out = String::new(); for (unit, suffix) in [(86_400_000_000_000u64, "d"), (3_600_000_000_000, "h"), (60_000_000_000, "m"), (1_000_000_000, "s"), (1_000_000, "ms"), (1000, "us"), (1, "ns")] { let n = rest / unit; rest %= unit; if n != 0 { out.push_str(&format!("{}{}", n, suffix)); } } if out.is_empty() { out.push_str("0ns"); } format!("LTIME#{}", out) }
// DATE, DT (seconds since 1970) and TOD (milliseconds) → STRING, as their literal zero-padded; a TOD's milliseconds only when
// non-zero — 'D#2026-05-09', 'DT#2026-05-29-12:30:45', 'TOD#07:05:03.250', 'TOD#23:59:59'. The civil date is Hinnant's
// days-from-civil inverse, mirrored line for line by the interpreter's civilDate.
fn iec_civil(days: i64) -> (i64, i64, i64) { let z = days + 719468; let era = z.div_euclid(146097); let doe = z - era * 146097; let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); let mp = (5 * doy + 2) / 153; let d = doy - (153 * mp + 2) / 5 + 1; let m = if mp < 10 { mp + 3 } else { mp - 9 }; (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d) }
fn iec_date_text(s: i64) -> String { let (y, m, d) = iec_civil(s.div_euclid(86400)); format!("D#{:04}-{:02}-{:02}", y, m, d) }
fn iec_dt_text(s: i64) -> String { let (y, m, d) = iec_civil(s.div_euclid(86400)); let t = s.rem_euclid(86400); format!("DT#{:04}-{:02}-{:02}-{:02}:{:02}:{:02}", y, m, d, t / 3600, t / 60 % 60, t % 60) }
fn iec_tod_text(ms: i64) -> String { let s = ms / 1000; let f = ms % 1000; if f == 0 { format!("TOD#{:02}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("TOD#{:02}:{:02}:{:02}.{:03}", s / 3600, s / 60 % 60, s % 60, f) } }
// LDT, LDATE and LTOD (nanoseconds, taken as i64: CODESYS reads them signed, so 2300 wraps to 1715) → STRING —
// 'LDT#2024-02-29-13:05:09.000000001', 'LD#2024-02-29', 'LTOD#00:00:00'; a zero fraction omitted, any other nine
// digits; the LDT's date floors, the LDATE's day truncates toward zero. Mirrors longCalendarText in the interpreter.
fn iec_lclock(ns: i64) -> String { let s = ns / 1_000_000_000; let f = ns % 1_000_000_000; if f == 0 { format!("{:02}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("{:02}:{:02}:{:02}.{:09}", s / 3600, s / 60 % 60, s % 60, f) } }
fn iec_ldt_text(ns: i64) -> String { let (y, m, d) = iec_civil(ns.div_euclid(86_400_000_000_000)); format!("LDT#{:04}-{:02}-{:02}-{}", y, m, d, iec_lclock(ns.rem_euclid(86_400_000_000_000))) }
fn iec_ldate_text(ns: i64) -> String { let (y, m, d) = iec_civil(ns / 86_400_000_000_000); format!("LD#{:04}-{:02}-{:02}", y, m, d) }
fn iec_ltod_text(ns: i64) -> String { format!("LTOD#{}", iec_lclock(ns)) }
`
