// generated from PLC_PRG — do not edit
#[allow(non_camel_case_types)]
#[derive(Debug, Clone, PartialEq)]
pub struct PLC_PRG {
    pub i: i16,
    pub hi: i32,
    pub total: i32,
}

impl PLC_PRG {
    pub fn new() -> Self {
        Self {
            i: 0i16,
            hi: 10i32,
            total: 0i32,
        }
    }

    pub fn scan(&mut self) {
        self.i = 1i16;
        loop {
            if !(self.i <= self.hi) { break; }
            {
                self.total = self.total.wrapping_add(1i32);
            }
            self.i = self.i.wrapping_add(1i16);
        }
    }
}

fn main(){ let mut p = PLC_PRG::new(); p.scan(); }
