// The emitted shape the handle-first hybrid would take, for the six memory-model fixtures. IEC declares every variable
// statically, so the application is ONE tree of owned values: plain structs, arrays by value, no Box/Rc/RefCell and no
// stored Rust reference. Only where ADR / REFERENCE / VAR_IN_OUT flows does a HANDLE appear: which declared place,
// plus an element index — resolved at the point of use.

// ── types ────────────────────────────────────────────────────────────────────
#[derive(Default, Clone, Copy, Debug, PartialEq)]
pub struct DutMemPt { pub x: i16, pub y: f32 }

#[derive(Default, Clone, Copy, Debug, PartialEq)]
pub struct DutMemIo { pub x: i16, pub y: i16 }

// ── globals: one struct, passed to a program as `&mut` beside its own `&mut self` (disjoint borrows) ──────────────
#[derive(Default)]
pub struct Globals { pub table: [DutMemPt; 5] }

// ── handles: one enum per pointee type, one variant per place an ADR of that type is TAKEN of (lowering knows them) ──
#[derive(Default, Clone, Copy, PartialEq, Debug)]
pub enum PtrDutMemPt { #[default] Null, PlcPrgArr(isize), GlobalsTable(isize) }

#[derive(Default, Clone, Copy, PartialEq, Debug)]
pub enum PtrFbMemCounter { #[default] Null, PlcPrgInst }

// ── function blocks: a struct of their VAR, methods take `&mut self` ─────────────────────────────────────────────
#[derive(Default)]
pub struct FbMemCounter { pub n: i16 }
impl FbMemCounter {
    pub fn bump(&mut self) { self.n = self.n.wrapping_add(1); }
}

#[derive(Default)]
pub struct FbMemInout {}
impl FbMemInout {
    // VAR_IN_OUT is a `&mut` PARAMETER, not a field. `p := ADR(io.y); p^ := 99` never lets the pointer outlive the call,
    // so it lowers to a reborrow — no handle needed.
    pub fn call(&mut self, io: &mut DutMemIo) {
        let p = &mut io.y;
        *p = 99;
    }
}

// ── the program ──────────────────────────────────────────────────────────────
#[derive(Default)]
pub struct PlcPrg {
    pub arr: [DutMemPt; 5],
    pub p: PtrDutMemPt,
    pub k: i16,
    pub via_deref: i16,
    pub via_index: i16,
    pub via_step: i16,
    pub written_back: i16,
    pub inst: FbMemCounter,
    pub p_inst: PtrFbMemCounter,
    pub got: i16,
    pub rec: DutMemIo,
    pub fbio: FbMemInout,
}

impl PlcPrg {
    /// `p[step]^` for a POINTER TO DUT_MEM_pt: the handle's last index moves by `step` elements.
    fn at<'a>(arr: &'a mut [DutMemPt; 5], g: &'a mut Globals, p: PtrDutMemPt, step: isize) -> &'a mut DutMemPt {
        match p {
            PtrDutMemPt::PlcPrgArr(i) => &mut arr[(i + step) as usize],
            PtrDutMemPt::GlobalsTable(i) => &mut g.table[(i + step) as usize],
            PtrDutMemPt::Null => panic!("dereference of a null POINTER TO DUT_MEM_pt"),
        }
    }

    pub fn scan(&mut self, g: &mut Globals) {
        // FOR k := 0 TO 4 DO arr[k].x := k * 10; END_FOR
        self.k = 0;
        while self.k <= 4 { self.arr[self.k as usize].x = self.k * 10; self.k += 1; }
        // p := ADR(arr[1]);
        self.p = PtrDutMemPt::PlcPrgArr(1);
        // viaDeref := p^.x; viaIndex := p[2].x; viaStep := (p + SIZEOF(DUT_MEM_pt))^.x;
        self.via_deref = Self::at(&mut self.arr, g, self.p, 0).x;
        self.via_index = Self::at(&mut self.arr, g, self.p, 2).x;
        self.via_step = Self::at(&mut self.arr, g, self.p, 1).x;
        // p[3].x := 77; writtenBack := arr[4].x;
        Self::at(&mut self.arr, g, self.p, 3).x = 77;
        self.written_back = self.arr[4].x;

        // pInst := ADR(inst); pInst^.Bump(); pInst^.Bump(); got := pInst^.n;
        self.p_inst = PtrFbMemCounter::PlcPrgInst;
        for _ in 0..2 {
            match self.p_inst {
                PtrFbMemCounter::PlcPrgInst => self.inst.bump(),
                PtrFbMemCounter::Null => panic!("dereference of a null POINTER TO FB_MEM_counter"),
            }
        }
        self.got = match self.p_inst { PtrFbMemCounter::PlcPrgInst => self.inst.n, PtrFbMemCounter::Null => panic!() };

        // fbio(io := rec);  — two fields of self, borrowed disjointly
        self.fbio.call(&mut self.rec);
    }
}

fn main() {
    let mut g = Globals::default();
    let mut prg = PlcPrg::default();
    prg.scan(&mut g);
    assert_eq!((prg.via_deref, prg.via_index, prg.via_step, prg.written_back), (10, 30, 20, 77));
    assert_eq!((prg.inst.n, prg.got), (2, 2));
    assert_eq!(prg.rec, DutMemIo { x: 0, y: 99 });
    // a handle into a GLOBAL through the same accessor — the program's own state and the globals stay separate borrows
    prg.p = PtrDutMemPt::GlobalsTable(0);
    PlcPrg::at(&mut prg.arr, &mut g, prg.p, 2).x = 5;
    assert_eq!(g.table[2].x, 5);
    println!("ok");
}
