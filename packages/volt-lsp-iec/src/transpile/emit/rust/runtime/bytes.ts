/**
 * A VALUE'S BYTES AT ANOTHER TYPE (lean 7.8.4) — the helpers `reinterpret.ts` prints a UNION member's overlay with, where
 * `to_le_bytes` / `from_le_bytes` alone do not reach: an array of elements wider than a byte, and two members of different
 * lengths. The twin of `semantics/memory.ts` `reinterpret`, held to `memory.cases.ts` by the twin harness.
 */

/** Every scalar a member can be, as its little-endian bytes and back — what `iec_bytes` / `iec_elements` walk an array by. */
export const IEC_LE = `trait IecLe: Copy {
    const W: usize;
    fn put(self, b: &mut [u8]);
    fn take(b: &[u8]) -> Self;
}

macro_rules! iec_le {
    ($($t:ty),*) => {$(
        impl IecLe for $t {
            const W: usize = std::mem::size_of::<$t>();
            fn put(self, b: &mut [u8]) {
                b.copy_from_slice(&self.to_le_bytes());
            }
            fn take(b: &[u8]) -> Self {
                let mut a = [0u8; std::mem::size_of::<$t>()];
                a.copy_from_slice(b);
                <$t>::from_le_bytes(a)
            }
        }
    )*};
}

iec_le!(u8, i8, u16, i16, u32, i32, u64, i64, f32, f64);
`

/** An array's elements as their bytes, in order. */
export const IEC_BYTES = `fn iec_bytes<T: IecLe, const K: usize, const N: usize>(a: [T; K]) -> [u8; N] {
    let mut b = [0u8; N];
    for (k, e) in a.into_iter().enumerate() {
        e.put(&mut b[k * T::W..(k + 1) * T::W]);
    }
    b
}
`

/** Bytes read back as an array's elements. */
export const IEC_ELEMENTS = `fn iec_elements<T: IecLe, const K: usize, const N: usize>(b: [u8; N]) -> [T; K] {
    std::array::from_fn(|k| T::take(&b[k * T::W..(k + 1) * T::W]))
}
`

/** \`v\`'s bytes laid from offset 0 over \`over\`'s: the longer's past the shorter's stay, the shorter's past the longer's
 *  are not read. */
export const IEC_OVERLAY = `fn iec_overlay<const N: usize, const M: usize>(mut over: [u8; N], v: [u8; M]) -> [u8; N] {
    let n = N.min(M);
    over[..n].copy_from_slice(&v[..n]);
    over
}
`
