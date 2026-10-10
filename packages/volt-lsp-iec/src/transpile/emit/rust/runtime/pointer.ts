/** The pointer helpers the emitted code calls: the null check of a TAG's dereference, and the byte image an ADDRESS points
 *  into (`Mem`, the twin of `semantics/memory.ts`, held to `memory.cases.ts` by the twin harness). */
import { FAULT_TEXT, rustFaultLiteral } from "../../../ir/faults.js"

/** The one check every dereference makes: a null pointer stops the program, as it stops the CODESYS application. */
export const IEC_DEREF = `fn iec_deref(at: usize) { if at == 0 { panic!(${rustFaultLiteral("null-dereference")}); } }
`

/**
 * THE BYTE IMAGE (design.md §3.3 step 4d): a program's bytes from \`IMAGE_BASE\`, and the region each belongs to (0 for
 * none). \`ld\`/\`st\` move N bytes little-endian at an address inside ONE region — anything else faults by name, as does the
 * order of two addresses in different regions. A program builds its own with \`Mem::new()\` (\`module.ts\`), from the
 * image lowering laid out; \`iec_ix\` is an index step on an address, its bounds checked as an element place checks them.
 * \`ld\` and \`st\` are \`pub\` and ride with every \`Mem\`: a harness reads and seeds an image-held variable through them
 * (\`test/conformance/support/rust-access.ts\`), whether the program's own code calls them or not.
 */
export const MEM = `const IMAGE_BASE: usize = 1 << 32;

#[derive(Debug, Clone, PartialEq)]
pub struct Mem {
    b: Vec<u8>,
    r: Vec<u32>,
}

impl Mem {
    fn image(size: usize, bytes: &[(usize, &[u8])], regions: &[(usize, usize)]) -> Self {
        let mut b = vec![0u8; size];
        for (at, run) in bytes {
            b[*at..*at + run.len()].copy_from_slice(run);
        }
        let mut r = vec![0u32; size];
        let mut id = 0u32;
        for (start, end) in regions {
            id += 1;
            r[*start..*end].fill(id);
        }
        Mem { b, r }
    }
}
`
export const MEM_REGION = `impl Mem {
    fn region(&self, a: usize) -> u32 {
        if a < IMAGE_BASE || a - IMAGE_BASE >= self.b.len() { 0 } else { self.r[a - IMAGE_BASE] }
    }
}
`
export const MEM_AT = `impl Mem {
    fn at(&self, a: usize, n: usize) -> usize {
        assert!(a != 0, ${rustFaultLiteral("null-dereference")});
        let region = self.region(a);
        assert!(region != 0 && self.region(a.wrapping_add(n - 1)) == region, ${JSON.stringify(FAULT_TEXT["address-outside-image"])});
        a - IMAGE_BASE
    }
}
`
export const MEM_LD = `impl Mem {
    #[must_use]
    pub fn ld<const N: usize>(&self, a: usize) -> [u8; N] {
        let i = self.at(a, N);
        let mut v = [0u8; N];
        v.copy_from_slice(&self.b[i..i + N]);
        v
    }
}
`
export const MEM_LD_BOOL = `impl Mem {
    fn ld_bool(&self, a: usize) -> bool {
        self.ld::<1>(a)[0] != 0
    }
}
`
export const MEM_ST = `impl Mem {
    pub fn st<const N: usize>(&mut self, a: usize, v: [u8; N]) {
        let i = self.at(a, N);
        self.b[i..i + N].copy_from_slice(&v);
    }
}
`
export const MEM_ORDER = `impl Mem {
    fn order(&self, a: usize, b: usize) -> i32 {
        // an address is in the region it falls in, and in the one whose last byte is just below it (one past the end)
        let ra = [self.region(a), self.region(a.wrapping_sub(1))];
        let rb = [self.region(b), self.region(b.wrapping_sub(1))];
        assert!(ra.iter().any(|&r| r != 0 && rb.contains(&r)), ${JSON.stringify(FAULT_TEXT["address-across-frames"])});
        match a.cmp(&b) {
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Greater => 1,
        }
    }
}
`
export const IEC_IX = `fn iec_ix(a: usize, i: i64, lower: i64, len: usize, size: usize) -> usize {
    match i.checked_sub(lower).and_then(|k| usize::try_from(k).ok()) {
        Some(k) if k < len => a + k * size,
        _ => panic!("array index {i} is outside its bounds"),
    }
}
`
