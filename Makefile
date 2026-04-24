UUID = gnome-clash-control@n8spxd
BUNDLE = $(UUID).zip

all: build install

.PHONY: build install clean

build:
	rm -f $(BUNDLE)
	gnome-extensions pack --force --podir=po \
	                       --extra-source=img
	mv $(UUID).shell-extension.zip $(BUNDLE)

install:
	gnome-extensions install $(BUNDLE) --force

clean:
	rm -f $(BUNDLE)
	rm -f schemas/gschemas.compiled
	rm -rf locale/
