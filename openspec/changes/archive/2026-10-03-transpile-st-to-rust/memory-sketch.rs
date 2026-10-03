// The emitted shape for the six memory-model fixtures — the SIMPLEST Rust the static IEC memory allows (design §9).
//
// IEC declares every variable in a declaration section: no heap, no lifetimes to infer. The application is one tree of
// owned values, so most of what C-like pointers suggest is not needed. Three rules, simplest first; lowering picks the
// first that applies:
//   1. a pointer whose target is STATIC (only ever one ADR of it) compiles to that place directly — no pointer at all;
//   2. a pointer that never outlives the call (a VAR_IN_OUT, a FUNCTION/METHOD pointer parameter, an ADR used inside
//      the same call) is a `&mut` borrow — a slice `&mut [T]` when it is indexed;
//   3. only a STORED pointer with several possible targets becomes a handle: an enum of its targets.
// No Box, Rc, RefCell or unsafe anywhere. Compiles under `-D warnings`; `main` asserts the values CODESYS recorded.

// ── types: a DUT is a plain struct ───────────────────────────────────────────
#[derive(Default, Clone, Copy, Debug, PartialEq)]
pub struct DutMemPt { pub x: i16, pub y: f32 }

#[derive(Default, Clone, Copy, Debug, PartialEq)]
pub struct DutMemIo { pub x: i16, pub y: i16 }

// ── globals: one struct, borrowed beside a program's own state ──────────────
#[derive(Default)]
pub struct Globals { pub table: [DutMemPt; 5] }

// ── an FB is a struct of its VAR; a method is `&mut self` ───────────────────
#[derive(Default)]
pub struct FbMemCounter { pub n: i16 }
impl FbMemCounter {
    pub fn bump(&mut self) { self.n = self.n.wrapping_add(1); }
}

#[derive(Default)]
pub struct FbMemInout {}
impl FbMemInout {
    /// Rule 2 — `VAR_IN_OUT io` is a `&mut` parameter, and `p := ADR(io.y); p^ := 99` inside the call is a reborrow.
    pub fn call(&mut self, io: &mut DutMemIo) {
        io.y = 99;
    }
}

/// Rule 2 — a FUNCTION keeps no state, so a `POINTER TO T` parameter indexed like an array
/// (`Calc_CopyCutsWithOffset(I_dataArray := ADR(arr), …)` in the corpus) is a slice.
pub fn sum_x(data: &[DutMemPt], first: usize, last: usize) -> i16 {
    data[first..=last].iter().fold(0i16, |acc, e| acc.wrapping_add(e.x))
}

// ── the program ──────────────────────────────────────────────────────────────
#[derive(Default)]
pub struct PlcPrg {
    pub arr: [DutMemPt; 5],
    pub k: i16,
    pub via_deref: i16,
    pub via_index: i16,
    pub via_step: i16,
    pub written_back: i16,
    pub inst: FbMemCounter,
    pub got: i16,
    pub rec: DutMemIo,
    pub fbio: FbMemInout,
    pub total: i16,
    pub source: Source,
    pub picked: i16,
}

/// Rule 3 — the one case a handle is needed: `pick` is STORED and points at either of two places.
#[derive(Default, Clone, Copy, PartialEq, Debug)]
pub enum Source { #[default] Null, PlcPrgArr(usize), GlobalsTable(usize) }

impl PlcPrg {
    pub fn scan(&mut self, g: &mut Globals) {
        // FOR k := 0 TO 4 DO arr[k].x := k * 10; END_FOR
        self.k = 0;
        while self.k <= 4 { self.arr[self.k as usize].x = self.k * 10; self.k += 1; }

        // Rule 1 — `p := ADR(arr[1])` is p's only target, so p is `arr[1 + i]`:
        // viaDeref := p^.x; viaIndex := p[2].x; q := p + SIZEOF(DUT_MEM_pt); viaStep := q^.x; p[3].x := 77;
        self.via_deref = self.arr[1].x;
        self.via_index = self.arr[1 + 2].x;
        self.via_step = self.arr[1 + 1].x;
        self.arr[1 + 3].x = 77;
        self.written_back = self.arr[4].x;

        // Rule 1 — `pInst := ADR(inst)`: pInst^.Bump(); pInst^.Bump(); got := pInst^.n;
        self.inst.bump();
        self.inst.bump();
        self.got = self.inst.n;

        // Rule 2 — fbio(io := rec);
        self.fbio.call(&mut self.rec);

        // Rule 2 — a FUNCTION given ADR(arr): a borrow for the call
        self.total = sum_x(&self.arr, 0, 4);

        // Rule 3 — IF k > 4 THEN pick := ADR(arr[2]) ELSE pick := ADR(table[0]) END_IF; picked := pick^.x;
        self.source = if self.k > 4 { Source::PlcPrgArr(2) } else { Source::GlobalsTable(0) };
        self.picked = match self.source {
            Source::PlcPrgArr(i) => self.arr[i].x,
            Source::GlobalsTable(i) => g.table[i].x,
            Source::Null => panic!("dereference of a null pointer"),
        };
    }
}

fn main() {
    let mut g = Globals::default();
    let mut prg = PlcPrg::default();
    prg.scan(&mut g);
    // the values CODESYS recorded (conformance `mem_*`)
    assert_eq!((prg.via_deref, prg.via_index, prg.via_step, prg.written_back), (10, 30, 20, 77));
    assert_eq!((prg.inst.n, prg.got), (2, 2));
    assert_eq!(prg.rec, DutMemIo { x: 0, y: 99 });
    // the two illustrations, not recorded: a slice parameter and a two-target handle
    assert_eq!(prg.total, 10 + 20 + 30 + 77);
    assert_eq!(prg.picked, 20); // k is 5 after the loop, so the handle picks arr[2]
    println!("ok");
}
